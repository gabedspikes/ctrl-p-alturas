import React from 'react'
import { useTheme, SLIDE_BG } from '../lib/theme'

// bg = relleno suave de cada caja (siempre visible, para que los más chicos
// asocien la caja con su letra); strong = relleno de la respuesta correcta.
const ANS_COLORS = {
  A: { bg: 'rgba(34,197,94,0.14)',  strong: 'rgba(34,197,94,0.38)',  border: '#22c55e', text: '#22c55e', label: '#22c55e' },
  B: { bg: 'rgba(59,130,246,0.14)', strong: 'rgba(59,130,246,0.38)', border: '#3b82f6', text: '#3b82f6', label: '#3b82f6' },
  C: { bg: 'rgba(249,115,22,0.14)', strong: 'rgba(249,115,22,0.38)', border: '#f97316', text: '#f97316', label: '#f97316' },
  D: { bg: 'rgba(239,68,68,0.14)',  strong: 'rgba(239,68,68,0.38)',  border: '#ef4444', text: '#ef4444', label: '#ef4444' },
}

// Caja de una alternativa: borde y relleno del color de su letra.
// La correcta (al revelar) se distingue con relleno más fuerte y borde más grueso.
// Grosor del borde de las cajas. El cuadrado de la letra usa el mismo grosor,
// para que los dos bordes calcen.
function boxBorderW(compact, scale) {
  return compact ? 1 : Math.max(2, 2.5 * scale)
}
function answerBox(col, isCorrect, compact, scale) {
  const w = boxBorderW(compact, scale)
  return {
    background: isCorrect ? col.strong : col.bg,
    border: `${w}px solid ${col.border}`,
    // El grosor extra de la correcta va hacia afuera (sombra), así su contenido
    // queda alineado con el de las demás cajas en vez de correrse hacia adentro.
    boxShadow: isCorrect ? `0 0 0 ${w}px ${col.border}` : 'none',
  }
}

// Fondo de la slide según el modo de la página (ya no se elige por slide;
// la columna bg_color solo registra el modo en que se guardó y no se usa aquí).

/**
 * SlideRenderer — shared component used by editor preview, session view, and scan page.
 * Props:
 *   slide         — slide object from Supabase
 *   width         — container width in px (default 720)
 *   height        — container height in px (default 405)
 *   showCorrect   — highlight correct answer (default false)
 *   compact       — smaller text for thumbnail use (default false)
 *   theme         — 'dark' | 'light' para forzar un modo; por defecto sigue
 *                   el modo claro/oscuro que el profesor tiene en la página
 */
export default function SlideRenderer({
  slide,
  width = 720,
  height = 405,
  showCorrect = false,
  compact = false,
  tally = null,        // { A:n, B:n, C:n, D:n } or null to hide
  totalStudents = 0,   // denominator for the percentage
  theme,
}) {
  const pageTheme = useTheme()
  if (!slide) return null

  const dark = (theme || pageTheme) === 'dark'
  const bg = dark ? SLIDE_BG.dark : SLIDE_BG.light
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
  const gridLayout = hasAnswers && slide.answer_layout === 'grid'
  // Imagen de la pregunta + respuestas en lista → lado a lado
  const sideBySide = hasImage && hasAnswers && !gridLayout

  
  const qFontSize = compact
    ? 11 * textScale
    : Math.max(14, Math.min(28, 28 - (slide.question_text?.length || 0) * 0.15)) * textScale * scale
  const aFontSize = (compact ? 9 : 13 * scale) * textScale

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
      {/* Question area (se omite si la pregunta es solo una imagen) */}
      {(hasQuestion || !hasImage) && (
      <div style={{
        flex: gridLayout ? '0 0 auto' : hasImage ? '0 0 auto' : hasAnswers ? '1 1 auto' : '1',
        padding: compact ? '10px 12px 6px' : `${20*scale}px ${28*scale}px ${12*scale}px`,
        display: 'flex',
        alignItems: hasAnswers || hasImage ? 'flex-start' : 'center',
        justifyContent: 'center',
        minHeight: hasImage ? 0 : (compact ? 40 : 80),   // con imagen no se reserva alto extra
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
          // Pregunta solo con imagen (p. ej. un ejercicio escaneado): sin aviso
          hasImage ? null : (
            <p style={{ color: mutedColor, fontSize: compact ? 9 : 16, margin: 0, fontStyle: 'italic' }}>
              No question text
            </p>
          )
        )}
      </div>
      )}

      {/* Imagen + respuestas en lista. Con imagen van lado a lado (imagen a la
          izquierda, respuestas a la derecha): en 16:9 así el gráfico o la
          fórmula tiene espacio de verdad. Sin imagen, como siempre. */}
      {sideBySide ? (
        <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'row', alignItems: 'stretch' }}>
      {/* Image — ocupa todo el espacio libre entre la pregunta y las respuestas.
          Antes tenía un alto fijo en píxeles (140), así que en un televisor se
          veía chica; ahora crece con la slide, igual que el texto. */}
      {hasImage && (
        <div style={{
          flex: '1 1 0',
          minHeight: compact ? 30 : 60 * scale,
          position: 'relative',
          margin: sideBySide
            ? (compact ? '4px 0 8px 12px' : `${(hasQuestion ? 4 : 20)*scale}px 0 ${20*scale}px ${28*scale}px`)
            : (compact ? `${hasQuestion ? 0 : 8}px 12px 0` : `${hasQuestion ? 0 : 20*scale}px ${28*scale}px 0`),
        }}>
          <img
            src={slide.image_url}
            alt="Slide"
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'contain',
              borderRadius: 4,
            }}
          />
        </div>
      )}
      {/* Answer rows */}
      {hasAnswers && !gridLayout && (
        <div style={{
          flex: sideBySide ? '0 0 46%' : '0 0 auto',
          minWidth: 0,
          justifyContent: sideBySide ? 'center' : undefined,
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
                display: 'flex', alignItems: 'center',
                gap: compact ? 5 : Math.max(6, 10*scale),
                ...answerBox(col, isCorrect, compact, scale),
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
                  border: `${boxBorderW(compact, scale)}px solid ${col.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: compact ? 9 : Math.max(11, 13*scale),
                  fontWeight: 800,
                  color: isCorrect ? '#fff' : col.label,
                  fontFamily: "'DM Mono', monospace",
                }}>{letter}</div>

                {/* Answer image (optional) */}
                {image && (
                  <img src={image} alt="" style={{
                    flex: 1, minHeight: 0, maxWidth: '100%',
                    objectFit: 'contain', borderRadius: 4,
                  }}/>
                )}

                {/* Answer text (una sola vez) */}
                <span style={{
                  color: text ? textColor : mutedColor,
                  fontSize: aFontSize,
                  fontStyle: text ? 'normal' : 'italic',
                  fontWeight: isCorrect ? 600 : 400,
                  lineHeight: 1.3,
                }}>
                  {text || (image ? '' : (compact ? '' : `Answer ${letter}`))}
                </span>

                {/* Live percentage */}
                {tally && (
                  <div style={{
                    marginLeft: 'auto', flexShrink: 0,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: compact ? 10 : Math.max(12, 15*scale),
                    fontWeight: 700, color: col.border,
                    minWidth: compact ? 34 : 52, textAlign: 'right',
                  }}>
                    {totalStudents ? Math.round((tally[letter] || 0) / totalStudents * 100) : 0}%
                    <span style={{
                      fontSize: compact ? 8 : Math.max(9, 11*scale),
                      color: mutedColor, marginLeft: 3, fontWeight: 400,
                    }}> ({tally[letter] || 0})</span>
                  </div>
                )}

                {/* Correct checkmark */}
                {isCorrect && !compact && (
                  <span style={{ marginLeft: tally ? 6 : 'auto', color: col.border, fontSize: 16, fontWeight: 800 }}>✓</span>
                )}
              </div>
            )
          })}
        </div>
      )}
        </div>
      ) : (<>
      {/* Image — ocupa todo el espacio libre entre la pregunta y las respuestas.
          Antes tenía un alto fijo en píxeles (140), así que en un televisor se
          veía chica; ahora crece con la slide, igual que el texto. */}
      {hasImage && (
        <div style={{
          flex: '1 1 0',
          minHeight: compact ? 30 : 60 * scale,
          position: 'relative',
          margin: sideBySide
            ? (compact ? '4px 0 8px 12px' : `${(hasQuestion ? 4 : 20)*scale}px 0 ${20*scale}px ${28*scale}px`)
            : (compact ? `${hasQuestion ? 0 : 8}px 12px 0` : `${hasQuestion ? 0 : 20*scale}px ${28*scale}px 0`),
        }}>
          <img
            src={slide.image_url}
            alt="Slide"
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'contain',
              borderRadius: 4,
            }}
          />
        </div>
      )}

      {/* Answer rows */}
      {hasAnswers && !gridLayout && (
        <div style={{
          flex: sideBySide ? '0 0 46%' : '0 0 auto',
          minWidth: 0,
          justifyContent: sideBySide ? 'center' : undefined,
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
                display: 'flex', alignItems: 'center',
                gap: compact ? 5 : Math.max(6, 10*scale),
                ...answerBox(col, isCorrect, compact, scale),
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
                  border: `${boxBorderW(compact, scale)}px solid ${col.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: compact ? 9 : Math.max(11, 13*scale),
                  fontWeight: 800,
                  color: isCorrect ? '#fff' : col.label,
                  fontFamily: "'DM Mono', monospace",
                }}>{letter}</div>

                {/* Answer image (optional) */}
                {image && (
                  <img src={image} alt="" style={{
                    flex: 1, minHeight: 0, maxWidth: '100%',
                    objectFit: 'contain', borderRadius: 4,
                  }}/>
                )}

                {/* Answer text (una sola vez) */}
                <span style={{
                  color: text ? textColor : mutedColor,
                  fontSize: aFontSize,
                  fontStyle: text ? 'normal' : 'italic',
                  fontWeight: isCorrect ? 600 : 400,
                  lineHeight: 1.3,
                }}>
                  {text || (image ? '' : (compact ? '' : `Answer ${letter}`))}
                </span>

                {/* Live percentage */}
                {tally && (
                  <div style={{
                    marginLeft: 'auto', flexShrink: 0,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: compact ? 10 : Math.max(12, 15*scale),
                    fontWeight: 700, color: col.border,
                    minWidth: compact ? 34 : 52, textAlign: 'right',
                  }}>
                    {totalStudents ? Math.round((tally[letter] || 0) / totalStudents * 100) : 0}%
                    <span style={{
                      fontSize: compact ? 8 : Math.max(9, 11*scale),
                      color: mutedColor, marginLeft: 3, fontWeight: 400,
                    }}> ({tally[letter] || 0})</span>
                  </div>
                )}

                {/* Correct checkmark */}
                {isCorrect && !compact && (
                  <span style={{ marginLeft: tally ? 6 : 'auto', color: col.border, fontSize: 16, fontWeight: 800 }}>✓</span>
                )}
              </div>
            )
          })}
        </div>
      )}
      </>)}
{/* Answer grid (2x2) — imagen arriba, texto abajo */}
      {hasAnswers && gridLayout && (
        <div style={{
          flex: 1, minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap: compact ? 4 : Math.max(6, 10*scale),
          padding: compact ? '4px 12px 8px' : `${8*scale}px ${28*scale}px ${20*scale}px`,
        }}>
          {answers.map(({ letter, text, image }) => {
            const col = ANS_COLORS[letter]
            const isCorrect = showCorrect && slide.correct_answer === letter
            return (
              <div key={letter} style={{
                display: 'flex', flexDirection: 'column', minHeight: 0,
                alignItems: 'center', justifyContent: 'center',
                gap: compact ? 3 : Math.max(4, 6*scale),
                ...answerBox(col, isCorrect, compact, scale),
                borderRadius: 6,
                padding: compact ? 4 : Math.max(6, 10*scale),
                overflow: 'hidden',
              }}>
                {image && (
                  <img src={image} alt={`Answer ${letter}`} style={{
                    flex: 1, minHeight: 0, maxWidth: '100%',
                    objectFit: 'contain', borderRadius: 4,
                  }}/>
                )}
                <div style={{
                  display: 'flex', alignItems: 'center', flexShrink: 0, maxWidth: '100%',
                  gap: compact ? 4 : Math.max(5, 8*scale),
                }}>
                  <div style={{
                    width: compact ? 16 : Math.max(20, 24*scale),
                    height: compact ? 16 : Math.max(20, 24*scale),
                    borderRadius: 4,
                    background: isCorrect ? col.border : 'transparent',
                    border: `${boxBorderW(compact, scale)}px solid ${col.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: compact ? 9 : Math.max(10, 12*scale),
                    fontWeight: 800,
                    color: isCorrect ? '#fff' : col.label,
                    fontFamily: "'DM Mono', monospace",
                  }}>{letter}</div>
                  <span style={{
                    color: text ? textColor : mutedColor,
                    fontSize: aFontSize,
                    fontWeight: isCorrect ? 600 : 400,
                    lineHeight: 1.25,
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{text || (image ? '' : `Answer ${letter}`)}</span>
                </div>
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