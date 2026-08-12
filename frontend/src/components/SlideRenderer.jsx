import React from 'react'

const ANS_COLORS = {
  A: { bg: 'rgba(34,197,94,0.15)',  border: '#22c55e', text: '#22c55e', label: '#22c55e' },
  B: { bg: 'rgba(59,130,246,0.15)', border: '#3b82f6', text: '#3b82f6', label: '#3b82f6' },
  C: { bg: 'rgba(249,115,22,0.15)', border: '#f97316', text: '#f97316', label: '#f97316' },
  D: { bg: 'rgba(239,68,68,0.15)',  border: '#ef4444', text: '#ef4444', label: '#ef4444' },
}

function isColorDark(hex = '#1a1a20') {
  try {
    const r = parseInt(hex.slice(1,3),16)
    const g = parseInt(hex.slice(3,5),16)
    const b = parseInt(hex.slice(5,7),16)
    return (r*299 + g*587 + b*114) / 1000 < 128
  } catch { return true }
}

/**
 * SlideRenderer — shared component used by editor preview, session view, and scan page.
 * Props:
 *   slide         — slide object from Supabase
 *   width         — container width in px (default 720)
 *   height        — container height in px (default 405)
 *   showCorrect   — highlight correct answer (default false)
 *   compact       — smaller text for thumbnail use (default false)
 */
export default function SlideRenderer({
  slide,
  width = 720,
  height = 405,
  showCorrect = false,
  compact = false,
  tally = null,        // { A:n, B:n, C:n, D:n } or null to hide
  totalStudents = 0,   // denominator for the percentage
}) {
  if (!slide) return null

  const bg = slide.bg_color || '#1a1a20'
  const dark = isColorDark(bg)
  const textColor = dark ? '#e8e8ec' : '#1a1a2e'
  const mutedColor = dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)'
  const scale = width / 720
  const textScale = slide.text_scale || 1

  const answers = [
    { letter: 'A', text: slide.answer_a, image: slide.answer_a_image },
    { letter: 'B', text: slide.answer_b, image: slide.answer_b_image },
    { letter: 'C', text: slide.answer_c, image: slide.answer_c_image },
    { letter: 'D', text: slide.answer_d, image: slide.answer_d_image },
  ]

  const hasAnswers = answers.some(a => a.text || a.image)
  const hasImage = !!slide.image_url
  const hasQuestion = !!slide.question_text

  const qFontSize = (compact ? 11 : Math.max(14, Math.min(28, 28 - (slide.question_text?.length || 0) * 0.15))) * textScale
  const aFontSize = (compact ? 9 : 13) * textScale

  return (
    <div style={{
      width, height,
      background: bg,
      borderRadius: 6,
      overflow: 'hidden',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'Syne', sans-serif",
      userSelect: 'none',
    }}>
      {/* Question area */}
      <div style={{
        flex: hasImage ? '0 0 auto' : hasAnswers ? '1 1 auto' : '1',
        padding: compact ? '10px 12px 6px' : `${20*scale}px ${28*scale}px ${12*scale}px`,
        display: 'flex',
        alignItems: hasAnswers || hasImage ? 'flex-start' : 'center',
        justifyContent: 'center',
        minHeight: compact ? 40 : 80,
      }}>
        {hasQuestion ? (
          <p style={{
            color: textColor,
            fontSize: qFontSize,
            fontWeight: 700,
            lineHeight: 1.35,
            margin: 0,
            width: '100%',
            textAlign: hasAnswers ? 'left' : 'center',
          }}>
            {slide.question_text}
          </p>
        ) : (
          <p style={{ color: mutedColor, fontSize: compact ? 9 : 16, margin: 0, fontStyle: 'italic' }}>
            No question text
          </p>
        )}
      </div>

      {/* Image */}
      {hasImage && (
        <div style={{
          flex: hasAnswers ? '0 0 auto' : '1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: compact ? '0 12px' : `0 ${28*scale}px`,
          maxHeight: compact ? 60 : hasAnswers ? 140 : 260,
          overflow: 'hidden',
        }}>
          <img
            src={slide.image_url}
            alt="Slide"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 4,
            }}
          />
        </div>
      )}

      {/* Answer rows */}
      {hasAnswers && (
        <div style={{
          flex: '0 0 auto',
          padding: compact ? '4px 12px 8px' : `${8*scale}px ${28*scale}px ${20*scale}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: compact ? 3 : Math.max(4, 8*scale),
        }}>
          {answers.map(({ letter, text, image }) => {
            if (!text && !image && !compact) return null
            const col = ANS_COLORS[letter]
            const isCorrect = showCorrect && slide.correct_answer === letter
            return (
              <div key={letter} style={{
                display: 'flex',
                alignItems: 'center',
                gap: compact ? 5 : Math.max(6, 10*scale),
                background: isCorrect ? col.bg : dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                border: `${compact ? 1 : 1.5}px solid ${isCorrect ? col.border : dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                borderRadius: 6,
                padding: compact ? '3px 6px' : `${Math.max(6, 10*scale)}px ${Math.max(8, 14*scale)}px`,
                transition: 'all .2s',
              }}>
                {/* Letter badge */}
                <div style={{
                  width: compact ? 18 : Math.max(22, 28*scale),
                  height: compact ? 18 : Math.max(22, 28*scale),
                  borderRadius: 4,
                  background: isCorrect ? col.border : 'transparent',
                  border: `2px solid ${col.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: compact ? 9 : Math.max(11, 13*scale),
                  fontWeight: 800,
                  color: isCorrect ? '#fff' : col.label,
                  fontFamily: "'DM Mono', monospace",
                }}>
                  {letter}
                  {isCorrect && !compact && (
                    <span style={{ position:'absolute', fontSize: 10 }}>✓</span>
                  )}
                </div>
                {/* Answer image (optional) */}
                {image && (
                  <img
                    src={image}
                    alt={`Answer ${letter}`}
                    style={{
                      height: compact ? 22 : Math.max(34, 46*scale),
                      maxWidth: '45%',
                      objectFit: 'contain',
                      borderRadius: 4,
                      flexShrink: 0,
                    }}
                  />
                )}{text || (image ? '' : (compact ? '' : `Answer ${letter}`))}
                {/* Answer text */}
                <span style={{
                  color: text ? textColor : mutedColor,
                  fontSize: aFontSize,
                  fontStyle: text ? 'normal' : 'italic',
                  fontWeight: isCorrect ? 600 : 400,
                  lineHeight: 1.3,
                }}>
                  {text || (compact ? '' : `Answer ${letter}`)}
                </span>
                {/* Live percentage for this option (session view only) */}
                {tally && (
                  <div style={{
                    marginLeft: 'auto',
                    flexShrink: 0,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: compact ? 10 : Math.max(12, 15*scale),
                    fontWeight: 700,
                    color: col.border,
                    minWidth: compact ? 34 : 52,
                    textAlign: 'right',
                  }}>
                    {totalStudents ? Math.round((tally[letter] || 0) / totalStudents * 100) : 0}%
                    <span style={{
                      fontSize: compact ? 8 : Math.max(9, 11*scale),
                      color: mutedColor, marginLeft: 3, fontWeight: 400,
                    }}>
                      ({tally[letter] || 0})
                    </span>
                  </div>
                )}
                {/* Correct checkmark */}
                {isCorrect && !compact && (
                  <span style={{ marginLeft: 'auto', color: col.border, fontSize: 16, fontWeight: 800 }}>✓</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {!hasQuestion && !hasAnswers && !hasImage && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: mutedColor, fontSize: compact ? 9 : 14, fontStyle: 'italic',
        }}>
          Empty slide
        </div>
      )}
    </div>
  )
}
