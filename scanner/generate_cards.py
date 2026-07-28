import cv2
import numpy as np
import argparse
import os
import math

def generate_card(card_id, size=400):
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    marker_size = int(size * 0.55)
    marker_img = cv2.aruco.drawMarker(aruco_dict, card_id, marker_size)
    card = np.ones((size, size, 3), dtype=np.uint8) * 255
    offset = (size - marker_size) // 2
    card[offset:offset+marker_size, offset:offset+marker_size] = cv2.cvtColor(marker_img, cv2.COLOR_GRAY2BGR)
    cv2.rectangle(card, (4, 4), (size-4, size-4), (0,0,0), 3)
    bold = cv2.FONT_HERSHEY_DUPLEX
    font = cv2.FONT_HERSHEY_SIMPLEX
    margin = 18
    cv2.putText(card, 'A', (size//2-12, margin+20), bold, 1.1, (0,0,0), 2)
    cv2.putText(card, 'C', (size//2-12, size-margin), bold, 1.1, (0,0,0), 2)
    cv2.putText(card, 'B', (size-margin-12, size//2+10), bold, 1.1, (0,0,0), 2)
    cv2.putText(card, 'D', (margin-8, size//2+10), bold, 1.1, (0,0,0), 2)
    id_str = str(card_id)
    cv2.putText(card, id_str, (8, 16), font, 0.5, (100,100,100), 1)
    cv2.putText(card, id_str, (size-30, 16), font, 0.5, (100,100,100), 1)
    cv2.putText(card, id_str, (8, size-6), font, 0.5, (100,100,100), 1)
    cv2.putText(card, id_str, (size-30, size-6), font, 0.5, (100,100,100), 1)
    return card

def make_sheet(cards, cols=4, padding=20):
    rows = math.ceil(len(cards) / cols)
    h, w = cards[0].shape[:2]
    sheet = np.ones((rows*(h+padding)+padding, cols*(w+padding)+padding, 3), dtype=np.uint8) * 245
    for i, card in enumerate(cards):
        r, c = divmod(i, cols)
        y = padding + r*(h+padding)
        x = padding + c*(w+padding)
        sheet[y:y+h, x:x+w] = card
    return sheet

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--count', type=int, default=10)
    parser.add_argument('--output', type=str, default='cards')
    parser.add_argument('--size', type=int, default=400)
    args = parser.parse_args()
    count = min(args.count, 50)
    os.makedirs(args.output, exist_ok=True)
    print(f"Generating {count} cards...")
    cards = []
    for i in range(1, count+1):
        card = generate_card(i, args.size)
        path = os.path.join(args.output, f'card_{i:02d}.png')
        cv2.imwrite(path, card)
        cards.append(card)
        print(f"  Card #{i} → {path}")
    sheet = make_sheet(cards)
    sheet_path = os.path.join(args.output, 'cards_sheet.png')
    cv2.imwrite(sheet_path, sheet)
    print(f"\nPrint sheet → {sheet_path}")
    print("A=top  B=right  C=bottom  D=left")

if __name__ == '__main__':
    main()
