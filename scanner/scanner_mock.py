"""
scanner_mock.py
---------------
Mockup scanner for UI testing — no Supabase needed.
Opens your webcam, detects ArUco markers, reads rotation for A/B/C/D,
and prints results to the terminal.

Also writes detections to scanner_output.json so you can manually
verify what the scanner is reading before wiring it to a backend.

Usage:
    python3 scanner_mock.py

Controls:
    Q  — quit
    R  — reset (clear scanned list)
    S  — print summary to terminal
"""

import cv2
import numpy as np
import json
import time
from datetime import datetime

OUTPUT_FILE = 'scanner_output.json'

# ── Answer from marker rotation ──────────────────────────────
def rotation_to_answer(corners) -> str:
    """
    Which edge of the marker is highest on screen (lowest Y) = answer held UP.
      A = top edge up   (normal)
      B = right edge up (rotated 90° CW)
      C = bottom edge up (rotated 180°)
      D = left edge up  (rotated 270° CW)
    """
    tl, tr, br, bl = corners[0]
    edges = {
        'A': (tl[1] + tr[1]) / 2,   # top edge avg Y
        'B': (tr[1] + br[1]) / 2,   # right edge avg Y
        'C': (br[1] + bl[1]) / 2,   # bottom edge avg Y
        'D': (bl[1] + tl[1]) / 2,   # left edge avg Y
    }
    return min(edges, key=edges.get)  # lowest Y = highest on screen


def rotation_angle_deg(corners) -> float:
    """Returns approximate rotation in degrees for display."""
    tl, tr = corners[0][0], corners[0][1]
    dx = tr[0] - tl[0]
    dy = tr[1] - tl[1]
    import math
    return math.degrees(math.atan2(dy, dx))


# ── Color map ────────────────────────────────────────────────
COLORS = {
    'A': (50,  220, 50),   # green
    'B': (220, 180, 50),   # blue-ish
    'C': (50,  180, 220),  # orange
    'D': (50,  50,  220),  # red
}

def main():
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    params = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, params)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("ERROR: Could not open webcam at /dev/video0")
        print("Try: ls /dev/video* to see available cameras")
        print("Then edit: cap = cv2.VideoCapture(N) with the right number")
        return

    print("\n" + "="*50)
    print("  PLICKERS SCANNER — MOCK MODE")
    print("="*50)
    print("  Hold printed ArUco cards up to the camera.")
    print("  Rotate card so your answer points UP:")
    print("    A = top up  B = right up  C = bottom up  D = left up")
    print("\n  Q=quit  R=reset  S=summary")
    print("="*50 + "\n")

    scanned = {}        # card_id → {answer, time}
    cooldown = {}       # card_id → last seen timestamp
    COOLDOWN_SEC = 1.5

    session_log = []    # full log for output file

    while True:
        ret, frame = cap.read()
        if not ret:
            print("Camera read failed — is another app using the webcam?")
            break

        corners, ids, _ = detector.detectMarkers(frame)
        display = frame.copy()

        if ids is not None:
            cv2.aruco.drawDetectedMarkers(display, corners, ids)

            for i, marker_id in enumerate(ids.flatten()):
                card_id = int(marker_id)
                answer = rotation_to_answer(corners[i])
                angle = rotation_angle_deg(corners[i])
                color = COLORS.get(answer, (255, 255, 255))

                cx = int(np.mean(corners[i][0][:, 0]))
                cy = int(np.mean(corners[i][0][:, 1]))

                now = time.time()
                cooled = (now - cooldown.get(card_id, 0)) > COOLDOWN_SEC

                if cooled:
                    cooldown[card_id] = now
                    if card_id not in scanned:
                        scanned[card_id] = {'answer': answer, 'time': datetime.now().isoformat()}
                        session_log.append({'card_id': card_id, 'answer': answer, 'angle': round(angle, 1)})
                        print(f"  Card #{card_id:02d}  →  {answer}  (angle: {angle:+.0f}°)")
                        # write to file after each detection
                        with open(OUTPUT_FILE, 'w') as f:
                            json.dump(session_log, f, indent=2)

                # overlay
                label = f"#{card_id} → {answer}"
                already = " ✓" if card_id in scanned else ""
                cv2.putText(display, label + already,
                    (cx - 40, cy - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

                # draw answer direction arrow
                h, w = display.shape[:2]
                arrow_tips = {
                    'A': (cx, cy - 50), 'B': (cx + 50, cy),
                    'C': (cx, cy + 50), 'D': (cx - 50, cy)
                }
                cv2.arrowedLine(display, (cx, cy), arrow_tips[answer], color, 2, tipLength=0.4)

        # HUD bar
        hud = f"Scanned: {len(scanned)} cards  |  Q=quit  R=reset  S=summary"
        cv2.rectangle(display, (0, 0), (display.shape[1], 36), (0,0,0), -1)
        cv2.putText(display, hud, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255,255,255), 1)

        # Answer legend
        legend_y = display.shape[0] - 10
        for idx, (ans, col) in enumerate(COLORS.items()):
            cv2.putText(display, f"{ans}", (10 + idx*40, legend_y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, col, 2)

        cv2.imshow('Plickers Scanner — Mock Mode', display)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord('r'):
            scanned.clear(); cooldown.clear(); session_log.clear()
            print("\n--- Reset ---\n")
        elif key == ord('s'):
            print(f"\n--- Summary ({len(scanned)} cards) ---")
            for cid, d in sorted(scanned.items()):
                print(f"  Card #{cid:02d} → {d['answer']}  at {d['time']}")
            print()

    cap.release()
    cv2.destroyAllWindows()
    print(f"\nSession ended. {len(scanned)} cards recorded.")
    if session_log:
        print(f"Results saved to: {OUTPUT_FILE}")

if __name__ == '__main__':
    main()
