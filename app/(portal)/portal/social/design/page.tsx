'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useOrg } from '@/lib/contexts/OrgContext'

// Type definitions
interface TextLayer {
  type: 'text'
  id: string
  x: number
  y: number
  width: number
  height: number
  content: string
  fontSize: number
  fontFamily: string
  fontWeight: 'normal' | 'bold' | '600' | '700'
  color: string
  alignment: 'left' | 'center' | 'right'
}

interface ImageLayer {
  type: 'image'
  id: string
  x: number
  y: number
  width: number
  height: number
  src: string
  opacity: number
  borderRadius: number
}

interface ShapeLayer {
  type: 'shape'
  id: string
  x: number
  y: number
  width: number
  height: number
  shapeType: 'rectangle' | 'circle'
  fillColor: string
  strokeColor: string
  strokeWidth: number
  opacity: number
}

type Layer = TextLayer | ImageLayer | ShapeLayer

interface Canvas {
  width: number
  height: number
  backgroundColor: string
  backgroundType: 'solid' | 'gradient' | 'image'
  backgroundGradient?: { from: string; to: string; angle: number }
  backgroundImage?: string
}

interface Template {
  name: string
  width: number
  height: number
  category: 'social' | 'story' | 'banner' | 'youtube'
  layers: Layer[]
  backgroundType: 'solid' | 'gradient' | 'image'
  backgroundColor: string
}

const TEMPLATES: Record<string, Template[]> = {
  social: [
    {
      name: 'Quote Card',
      width: 1080,
      height: 1080,
      category: 'social',
      backgroundColor: '#1F2937',
      backgroundType: 'solid',
      layers: [
        {
          type: 'text',
          id: 'quote',
          x: 100,
          y: 400,
          width: 880,
          height: 280,
          content: '"Great things never came from comfort zones"',
          fontSize: 48,
          fontFamily: 'Inter',
          fontWeight: '700',
          color: '#FFFFFF',
          alignment: 'center',
        },
        {
          type: 'text',
          id: 'author',
          x: 100,
          y: 720,
          width: 880,
          height: 60,
          content: ' -  Author Name',
          fontSize: 24,
          fontFamily: 'Inter',
          fontWeight: '600',
          color: '#F59E0B',
          alignment: 'center',
        },
      ],
    },
    {
      name: 'Product Feature',
      width: 1080,
      height: 1080,
      category: 'social',
      backgroundColor: '#FFFFFF',
      backgroundType: 'solid',
      layers: [
        {
          type: 'text',
          id: 'title',
          x: 50,
          y: 50,
          width: 980,
          height: 100,
          content: 'Introducing Product Name',
          fontSize: 52,
          fontFamily: 'Inter',
          fontWeight: '700',
          color: '#1F2937',
          alignment: 'left',
        },
        {
          type: 'text',
          id: 'desc',
          x: 50,
          y: 200,
          width: 980,
          height: 300,
          content: 'Add your product description and key features here.',
          fontSize: 28,
          fontFamily: 'Inter',
          fontWeight: 'normal',
          color: '#6B7280',
          alignment: 'left',
        },
        {
          type: 'shape',
          id: 'ctabox',
          x: 50,
          y: 850,
          width: 980,
          height: 120,
          shapeType: 'rectangle',
          fillColor: '#F59E0B',
          strokeColor: '#F59E0B',
          strokeWidth: 0,
          opacity: 1,
        },
      ],
    },
    {
      name: 'Announcement',
      width: 1080,
      height: 1080,
      category: 'social',
      backgroundColor: '#F59E0B',
      backgroundType: 'solid',
      layers: [
        {
          type: 'text',
          id: 'announce',
          x: 100,
          y: 350,
          width: 880,
          height: 300,
          content: '🎉 BIG ANNOUNCEMENT',
          fontSize: 64,
          fontFamily: 'Inter',
          fontWeight: '700',
          color: '#FFFFFF',
          alignment: 'center',
        },
        {
          type: 'text',
          id: 'detail',
          x: 100,
          y: 700,
          width: 880,
          height: 200,
          content: 'Coming soon. Stay tuned!',
          fontSize: 32,
          fontFamily: 'Inter',
          fontWeight: '600',
          color: '#1F2937',
          alignment: 'center',
        },
      ],
    },
  ],
  story: [
    {
      name: 'Event Promo',
      width: 1080,
      height: 1920,
      category: 'story',
      backgroundColor: '#1F2937',
      backgroundType: 'solid',
      layers: [
        {
          type: 'text',
          id: 'eventname',
          x: 100,
          y: 200,
          width: 880,
          height: 150,
          content: 'Join Us',
          fontSize: 72,
          fontFamily: 'Inter',
          fontWeight: '700',
          color: '#F59E0B',
          alignment: 'center',
        },
        {
          type: 'text',
          id: 'eventdetail',
          x: 100,
          y: 500,
          width: 880,
          height: 300,
          content: 'Next month, be part of something amazing.',
          fontSize: 40,
          fontFamily: 'Inter',
          fontWeight: '600',
          color: '#FFFFFF',
          alignment: 'center',
        },
        {
          type: 'text',
          id: 'cta',
          x: 100,
          y: 1700,
          width: 880,
          height: 100,
          content: 'Link in bio →',
          fontSize: 36,
          fontFamily: 'Inter',
          fontWeight: '700',
          color: '#F59E0B',
          alignment: 'center',
        },
      ],
    },
  ],
  banner: [
    {
      name: 'Blog Header',
      width: 1200,
      height: 628,
      category: 'banner',
      backgroundColor: '#1F2937',
      backgroundType: 'solid',
      layers: [
        {
          type: 'text',
          id: 'title',
          x: 50,
          y: 100,
          width: 1100,
          height: 250,
          content: 'Blog Post Title',
          fontSize: 56,
          fontFamily: 'Inter',
          fontWeight: '700',
          color: '#FFFFFF',
          alignment: 'left',
        },
        {
          type: 'text',
          id: 'date',
          x: 50,
          y: 400,
          width: 1100,
          height: 60,
          content: 'March 13, 2026',
          fontSize: 20,
          fontFamily: 'Inter',
          fontWeight: 'normal',
          color: '#F59E0B',
          alignment: 'left',
        },
      ],
    },
  ],
  youtube: [
    {
      name: 'Tutorial Thumbnail',
      width: 1280,
      height: 720,
      category: 'youtube',
      backgroundColor: '#FF0000',
      backgroundType: 'solid',
      layers: [
        {
          type: 'text',
          id: 'title',
          x: 40,
          y: 150,
          width: 1200,
          height: 400,
          content: 'Tutorial Title',
          fontSize: 80,
          fontFamily: 'Inter',
          fontWeight: '700',
          color: '#FFFFFF',
          alignment: 'center',
        },
      ],
    },
  ],
}

const FONT_FAMILIES = [
  'Inter',
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Trebuchet MS',
]

const CANVAS_PRESETS = [
  { label: 'Social Post', width: 1080, height: 1080 },
  { label: 'Story', width: 1080, height: 1920 },
  { label: 'Banner', width: 1200, height: 628 },
  { label: 'YouTube', width: 1280, height: 720 },
]

export default function DesignPage() {
  const { orgId } = useOrg()
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Canvas state
  const [canvas, setCanvas] = useState<Canvas>({
    width: 1080,
    height: 1080,
    backgroundColor: '#1F2937',
    backgroundType: 'solid',
  })

  const [layers, setLayers] = useState<Layer[]>([])
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null)
  const [history, setHistory] = useState<Layer[][]>([[]])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

  // UI state
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null)
  const [exportName, setExportName] = useState('design')
  const [exporting, setExporting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Load template
  const loadTemplate = (category: keyof typeof TEMPLATES, templateName: string) => {
    const template = TEMPLATES[category].find(t => t.name === templateName)
    if (!template) return

    setCanvas({
      width: template.width,
      height: template.height,
      backgroundColor: template.backgroundColor,
      backgroundType: template.backgroundType,
    })
    setLayers(template.layers)
    setSelectedLayerId(null)
    setActiveTemplate(templateName)
    setHistory([template.layers])
    setHistoryIndex(0)
  }

  // Canvas operations
  const addText = useCallback(() => {
    const newId = `text-${Date.now()}`
    const newLayer: TextLayer = {
      type: 'text',
      id: newId,
      x: 100,
      y: 100,
      width: 400,
      height: 60,
      content: 'New text',
      fontSize: 24,
      fontFamily: 'Inter',
      fontWeight: '600',
      color: '#FFFFFF',
      alignment: 'left',
    }
    updateLayers([...layers, newLayer])
    setSelectedLayerId(newId)
  }, [layers])

  const addImage = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const src = event.target?.result as string
      const img = new Image()
      img.onload = () => {
        const newId = `image-${Date.now()}`
        const newLayer: ImageLayer = {
          type: 'image',
          id: newId,
          x: 100,
          y: 100,
          width: 300,
          height: 300,
          src,
          opacity: 1,
          borderRadius: 0,
        }
        updateLayers([...layers, newLayer])
        setSelectedLayerId(newId)
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  }, [layers])

  const addShape = useCallback((shapeType: 'rectangle' | 'circle') => {
    const newId = `shape-${Date.now()}`
    const newLayer: ShapeLayer = {
      type: 'shape',
      id: newId,
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      shapeType,
      fillColor: '#F59E0B',
      strokeColor: '#000000',
      strokeWidth: 0,
      opacity: 1,
    }
    updateLayers([...layers, newLayer])
    setSelectedLayerId(newId)
  }, [layers])

  const updateLayers = (newLayers: Layer[]) => {
    setLayers(newLayers)
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(newLayers)
    setHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
  }

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      setLayers(history[newIndex])
    }
  }, [history, historyIndex])

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      setLayers(history[newIndex])
    }
  }, [history, historyIndex])

  const deleteLayer = useCallback(() => {
    if (!selectedLayerId) return
    const newLayers = layers.filter(l => l.id !== selectedLayerId)
    updateLayers(newLayers)
    setSelectedLayerId(null)
  }, [layers, selectedLayerId])

  const updateSelectedLayer = useCallback((updates: Partial<Layer>) => {
    if (!selectedLayerId) return
    const newLayers = layers.map(l =>
      l.id === selectedLayerId ? { ...l, ...updates } : l
    )
    updateLayers(newLayers as Layer[])
  }, [layers, selectedLayerId])

  // Canvas rendering
  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return

    const ctx = canvasEl.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvasEl.width = canvas.width * dpr
    canvasEl.height = canvas.height * dpr
    ctx.scale(dpr, dpr)

    // Draw background
    ctx.fillStyle = canvas.backgroundColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw layers
    layers.forEach(layer => {
      ctx.save()

      // Draw selection box
      if (layer.id === selectedLayerId) {
        ctx.strokeStyle = '#F59E0B'
        ctx.lineWidth = 2
        ctx.setLineDash([5, 5])
        ctx.strokeRect(layer.x - 2, layer.y - 2, layer.width + 4, layer.height + 4)
        ctx.setLineDash([])
      }

      if (layer.type === 'text') {
        ctx.fillStyle = layer.color
        ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`
        ctx.textAlign = layer.alignment as CanvasTextAlign
        ctx.textBaseline = 'top'

        const x =
          layer.alignment === 'center'
            ? layer.x + layer.width / 2
            : layer.alignment === 'right'
              ? layer.x + layer.width
              : layer.x

        const words = layer.content.split(' ')
        let line = ''
        let y = layer.y
        const lineHeight = layer.fontSize * 1.2

        words.forEach(word => {
          const testLine = line + word + ' '
          const metrics = ctx.measureText(testLine)
          if (metrics.width > layer.width && line) {
            ctx.fillText(line, x, y)
            line = word + ' '
            y += lineHeight
          } else {
            line = testLine
          }
        })
        ctx.fillText(line, x, y)
      } else if (layer.type === 'image') {
        const img = new Image()
        img.onload = () => {
          ctx.globalAlpha = layer.opacity
          ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height)
          ctx.globalAlpha = 1
        }
        img.src = layer.src
      } else if (layer.type === 'shape') {
        ctx.globalAlpha = layer.opacity
        ctx.fillStyle = layer.fillColor
        ctx.strokeStyle = layer.strokeColor
        ctx.lineWidth = layer.strokeWidth

        if (layer.shapeType === 'rectangle') {
          ctx.fillRect(layer.x, layer.y, layer.width, layer.height)
          if (layer.strokeWidth > 0) {
            ctx.strokeRect(layer.x, layer.y, layer.width, layer.height)
          }
        } else if (layer.shapeType === 'circle') {
          ctx.beginPath()
          ctx.arc(
            layer.x + layer.width / 2,
            layer.y + layer.height / 2,
            Math.min(layer.width, layer.height) / 2,
            0,
            Math.PI * 2
          )
          ctx.fill()
          if (layer.strokeWidth > 0) {
            ctx.stroke()
          }
        }

        ctx.globalAlpha = 1
      }

      ctx.restore()
    })
  }, [canvas, layers, selectedLayerId])

  // Mouse handlers
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Find clicked layer
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i]
      if (
        x >= layer.x &&
        x <= layer.x + layer.width &&
        y >= layer.y &&
        y <= layer.y + layer.height
      ) {
        setSelectedLayerId(layer.id)
        setDragging(true)
        setDragStart({ x: x - layer.x, y: y - layer.y })
        return
      }
    }

    setSelectedLayerId(null)
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging || !selectedLayerId) return

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    updateSelectedLayer({
      x: Math.max(0, x - dragStart.x),
      y: Math.max(0, y - dragStart.y),
    })
  }

  const handleCanvasMouseUp = () => {
    setDragging(false)
  }

  // Export to PNG
  const exportToPNG = async () => {
    if (!canvasRef.current || !orgId) {
      setErrorMsg('Missing canvas or organization')
      return
    }

    try {
      setExporting(true)
      setErrorMsg('')

      // Create a temporary canvas for export
      const exportCanvas = document.createElement('canvas')
      exportCanvas.width = canvas.width
      exportCanvas.height = canvas.height
      const ctx = exportCanvas.getContext('2d')

      if (!ctx) {
        throw new Error('Failed to get canvas context')
      }

      // Draw background
      ctx.fillStyle = canvas.backgroundColor
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Draw layers without selection box
      for (const layer of layers) {
        if (layer.type === 'text') {
          ctx.fillStyle = layer.color
          ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`
          ctx.textAlign = layer.alignment as CanvasTextAlign
          ctx.textBaseline = 'top'

          const x =
            layer.alignment === 'center'
              ? layer.x + layer.width / 2
              : layer.alignment === 'right'
                ? layer.x + layer.width
                : layer.x

          const words = layer.content.split(' ')
          let line = ''
          let y = layer.y
          const lineHeight = layer.fontSize * 1.2

          words.forEach(word => {
            const testLine = line + word + ' '
            const metrics = ctx.measureText(testLine)
            if (metrics.width > layer.width && line) {
              ctx.fillText(line, x, y)
              line = word + ' '
              y += lineHeight
            } else {
              line = testLine
            }
          })
          ctx.fillText(line, x, y)
        } else if (layer.type === 'image') {
          await new Promise<void>(resolve => {
            const img = new Image()
            img.onload = () => {
              ctx.globalAlpha = layer.opacity
              ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height)
              ctx.globalAlpha = 1
              resolve()
            }
            img.onerror = () => resolve()
            img.src = layer.src
          })
        } else if (layer.type === 'shape') {
          ctx.globalAlpha = layer.opacity
          ctx.fillStyle = layer.fillColor
          ctx.strokeStyle = layer.strokeColor
          ctx.lineWidth = layer.strokeWidth

          if (layer.shapeType === 'rectangle') {
            ctx.fillRect(layer.x, layer.y, layer.width, layer.height)
            if (layer.strokeWidth > 0) {
              ctx.strokeRect(layer.x, layer.y, layer.width, layer.height)
            }
          } else if (layer.shapeType === 'circle') {
            ctx.beginPath()
            ctx.arc(
              layer.x + layer.width / 2,
              layer.y + layer.height / 2,
              Math.min(layer.width, layer.height) / 2,
              0,
              Math.PI * 2
            )
            ctx.fill()
            if (layer.strokeWidth > 0) {
              ctx.stroke()
            }
          }

          ctx.globalAlpha = 1
        }
      }

      // Convert to blob and upload
      exportCanvas.toBlob(async blob => {
        if (!blob) {
          throw new Error('Failed to create blob')
        }

        const formData = new FormData()
        formData.append('file', blob, `${exportName || 'design'}.png`)

        const response = await fetch(`/api/v1/social/media?orgId=${orgId}`, {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Upload failed')
        }

        const data = await response.json()
        setSuccessMsg('Design exported successfully!')
        setTimeout(() => {
          setSuccessMsg('')
        }, 3000)
      }, 'image/png')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const selectedLayer = layers.find(l => l.id === selectedLayerId)

  return (
    <div className="min-h-screen bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] flex flex-col">
      {/* Header */}
      <div className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-6 py-4">
        <h1 className="pib-page-title text-2xl">Design Editor</h1>
        <p className="pib-page-sub mt-1">Create stunning social media designs</p>
      </div>

      {/* Alerts */}
      {errorMsg && (
        <div className="bg-[var(--color-error-container)] border border-[var(--color-error)]/30 text-[var(--color-error)] px-6 py-3">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="bg-[var(--color-pib-success)]/10 border border-[var(--color-pib-success)]/30 text-[var(--color-pib-success)] px-6 py-3">
          {successMsg}
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Templates */}
        <div className="w-64 border-r border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] overflow-y-auto">
          <div className="p-4 space-y-6">
            {Object.entries(TEMPLATES).map(([category, templates]) => (
              <div key={category}>
                <h2 className="text-sm font-medium text-[var(--color-pib-rose)] mb-3 uppercase tracking-wider">
                  {category === 'social'
                    ? 'Social Posts'
                    : category === 'story'
                      ? 'Stories'
                      : category === 'banner'
                        ? 'Banners'
                        : 'YouTube'}
                </h2>
                <div className="space-y-2">
                  {templates.map(template => (
                    <button
                      key={template.name}
                      onClick={() => loadTemplate(category as keyof typeof TEMPLATES, template.name)}
                      className={`w-full text-left text-sm px-3 py-2 rounded border transition-colors ${
                        activeTemplate === template.name
                          ? 'border-[var(--color-pib-rose)] bg-[var(--color-pib-rose-soft)] text-[var(--color-pib-text)]'
                          : 'border-[var(--color-pib-line)] hover:border-[var(--color-pib-line-strong)] text-[var(--color-pib-text-muted)]'
                      }`}
                    >
                      <div className="font-medium">{template.name}</div>
                      <div className="text-xs text-[var(--color-pib-text-faint)]">
                        {template.width}x{template.height}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Center - Canvas */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-pib-bg)]">
          {/* Toolbar */}
          <div className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-4 py-3 flex items-center gap-3 flex-wrap">
            <button
              onClick={addText}
              className="pib-btn-secondary text-sm px-3 py-2"
            >
              + Text
            </button>
            <button
              onClick={addImage}
              className="pib-btn-secondary text-sm px-3 py-2"
            >
              + Image
            </button>
            <button
              onClick={() => addShape('rectangle')}
              className="pib-btn-secondary text-sm px-3 py-2"
            >
              + Rectangle
            </button>
            <button
              onClick={() => addShape('circle')}
              className="pib-btn-secondary text-sm px-3 py-2"
            >
              + Circle
            </button>

            <div className="border-l border-[var(--color-pib-line)] h-6" />

            <button
              onClick={undo}
              disabled={historyIndex === 0}
              className="pib-btn-secondary text-sm px-3 py-2 disabled:opacity-50"
            >
              ↶ Undo
            </button>
            <button
              onClick={redo}
              disabled={historyIndex === history.length - 1}
              className="pib-btn-secondary text-sm px-3 py-2 disabled:opacity-50"
            >
              ↷ Redo
            </button>

            <div className="border-l border-[var(--color-pib-line)] h-6" />

            <select aria-label="Width"
              value={`${canvas.width}x${canvas.height}`}
              onChange={e => {
                const [w, h] = e.target.value.split('x').map(Number)
                setCanvas(prev => ({ ...prev, width: w, height: h }))
              }}
              className="pib-btn-secondary text-sm px-3 py-2 bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded"
            >
              {CANVAS_PRESETS.map(p => (
                <option key={`${p.width}x${p.height}`} value={`${p.width}x${p.height}`}>
                  {p.label}
                </option>
              ))}
            </select>

            <div className="ml-auto flex gap-2">
              <button
                onClick={exportToPNG}
                disabled={exporting}
                className="pib-btn-primary text-sm px-4 py-2"
              >
                {exporting ? 'Exporting...' : 'Export PNG'}
              </button>
              <button
                onClick={() => router.push('/portal/social/compose')}
                className="pib-btn-primary text-sm px-4 py-2 bg-[var(--color-pib-rose)] hover:opacity-90"
              >
                Use in Post
              </button>
            </div>
          </div>

          {/* Canvas area */}
          <div className="flex-1 overflow-auto flex items-center justify-center bg-[var(--color-pib-surface-2)] p-8">
            <div
              style={{
                width: canvas.width,
                height: canvas.height,
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              }}
            >
              <canvas
                ref={canvasRef}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
                className="border border-[var(--color-pib-line)] cursor-move w-full h-full"
              />
            </div>
          </div>
        </div>

        {/* Right sidebar - Properties */}
        <div className="w-80 border-l border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Canvas properties */}
            <div className="pib-card p-4 bg-[var(--color-pib-bg)] border border-[var(--color-pib-line)]">
              <h3 className="text-sm font-medium text-[var(--color-pib-rose)] mb-4">Canvas</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-[var(--color-pib-text-muted)]">Width</label>
                  <input aria-label="Width"
                    type="number"
                    value={canvas.width}
                    onChange={e =>
                      setCanvas(prev => ({ ...prev, width: parseInt(e.target.value) }))
                    }
                    className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-pib-text-muted)]">Height</label>
                  <input aria-label="Height"
                    type="number"
                    value={canvas.height}
                    onChange={e =>
                      setCanvas(prev => ({ ...prev, height: parseInt(e.target.value) }))
                    }
                    className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-pib-text-muted)]">Background Color</label>
                  <div className="flex gap-2 mt-1">
                    <input aria-label="Background Color"
                      type="color"
                      value={canvas.backgroundColor}
                      onChange={e =>
                        setCanvas(prev => ({ ...prev, backgroundColor: e.target.value }))
                      }
                      className="w-12 h-8 rounded border border-[var(--color-pib-line)] cursor-pointer"
                    />
                    <input aria-label="Background Color"
                      type="text"
                      value={canvas.backgroundColor}
                      onChange={e =>
                        setCanvas(prev => ({ ...prev, backgroundColor: e.target.value }))
                      }
                      className="flex-1 bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Layer properties */}
            {selectedLayer ? (
              <>
                <div className="pib-card p-4 bg-[var(--color-pib-bg)] border border-[var(--color-pib-line)]">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-[var(--color-pib-rose)]">
                      {selectedLayer.type === 'text'
                        ? 'Text Layer'
                        : selectedLayer.type === 'image'
                          ? 'Image Layer'
                          : 'Shape Layer'}
                    </h3>
                    <button
                      onClick={deleteLayer}
                      className="text-xs px-2 py-1 bg-[var(--color-error-container)] hover:opacity-80 rounded text-[var(--color-error)]"
                    >
                      Delete
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-[var(--color-pib-text-muted)]">X</label>
                        <input aria-label="X"
                          type="number"
                          value={selectedLayer.x}
                          onChange={e =>
                            updateSelectedLayer({ x: parseInt(e.target.value) })
                          }
                          className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--color-pib-text-muted)]">Y</label>
                        <input aria-label="Y"
                          type="number"
                          value={selectedLayer.y}
                          onChange={e =>
                            updateSelectedLayer({ y: parseInt(e.target.value) })
                          }
                          className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--color-pib-text-muted)]">Width</label>
                        <input aria-label="Width"
                          type="number"
                          value={selectedLayer.width}
                          onChange={e =>
                            updateSelectedLayer({ width: parseInt(e.target.value) })
                          }
                          className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--color-pib-text-muted)]">Height</label>
                        <input aria-label="Height"
                          type="number"
                          value={selectedLayer.height}
                          onChange={e =>
                            updateSelectedLayer({ height: parseInt(e.target.value) })
                          }
                          className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1"
                        />
                      </div>
                    </div>

                    {/* Text layer properties */}
                    {selectedLayer.type === 'text' && (
                      <>
                        <div>
                          <label className="text-xs text-[var(--color-pib-text-muted)]">Text</label>
                          <textarea aria-label="Text"
                            value={selectedLayer.content}
                            onChange={e =>
                              updateSelectedLayer({ content: e.target.value })
                            }
                            className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1 resize-none h-20"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-[var(--color-pib-text-muted)]">Font Size</label>
                            <input aria-label="Font Size"
                              type="number"
                              value={selectedLayer.fontSize}
                              onChange={e =>
                                updateSelectedLayer({ fontSize: parseInt(e.target.value) })
                              }
                              className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-[var(--color-pib-text-muted)]">Font Weight</label>
                            <select aria-label="Font Weight"
                              value={selectedLayer.fontWeight}
                              onChange={e =>
                                updateSelectedLayer({
                                  fontWeight: e.target.value as any,
                                })
                              }
                              className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1"
                            >
                              <option value="normal">Normal</option>
                              <option value="600">Semi Bold</option>
                              <option value="bold">Bold</option>
                              <option value="700">Very Bold</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-[var(--color-pib-text-muted)]">Font Family</label>
                          <select aria-label="Font Family"
                            value={selectedLayer.fontFamily}
                            onChange={e =>
                              updateSelectedLayer({ fontFamily: e.target.value })
                            }
                            className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1"
                          >
                            {FONT_FAMILIES.map(f => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-[var(--color-pib-text-muted)]">Color</label>
                            <div className="flex gap-2 mt-1">
                              <input aria-label="Color"
                                type="color"
                                value={selectedLayer.color}
                                onChange={e =>
                                  updateSelectedLayer({ color: e.target.value })
                                }
                                className="w-10 h-8 rounded border border-[var(--color-pib-line)] cursor-pointer"
                              />
                              <input aria-label="Color"
                                type="text"
                                value={selectedLayer.color}
                                onChange={e =>
                                  updateSelectedLayer({ color: e.target.value })
                                }
                                className="flex-1 bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-[var(--color-pib-text-muted)]">Align</label>
                            <select aria-label="Align"
                              value={selectedLayer.alignment}
                              onChange={e =>
                                updateSelectedLayer({
                                  alignment: e.target.value as any,
                                })
                              }
                              className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1"
                            >
                              <option value="left">Left</option>
                              <option value="center">Center</option>
                              <option value="right">Right</option>
                            </select>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Image layer properties */}
                    {selectedLayer.type === 'image' && (
                      <>
                        <div>
                          <label className="text-xs text-[var(--color-pib-text-muted)]">Opacity</label>
                          <input aria-label="Opacity"
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={selectedLayer.opacity}
                            onChange={e =>
                              updateSelectedLayer({
                                opacity: parseFloat(e.target.value),
                              })
                            }
                            className="w-full"
                          />
                          <div className="text-xs text-[var(--color-pib-text-faint)] mt-1">
                            {Math.round(selectedLayer.opacity * 100)}%
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-[var(--color-pib-text-muted)]">Border Radius</label>
                          <input aria-label="Border Radius"
                            type="range"
                            min="0"
                            max="50"
                            value={selectedLayer.borderRadius}
                            onChange={e =>
                              updateSelectedLayer({
                                borderRadius: parseInt(e.target.value),
                              })
                            }
                            className="w-full"
                          />
                          <div className="text-xs text-[var(--color-pib-text-faint)] mt-1">
                            {selectedLayer.borderRadius}px
                          </div>
                        </div>
                      </>
                    )}

                    {/* Shape layer properties */}
                    {selectedLayer.type === 'shape' && (
                      <>
                        <div>
                          <label className="text-xs text-[var(--color-pib-text-muted)]">Shape Type</label>
                          <select aria-label="Shape Type"
                            value={selectedLayer.shapeType}
                            onChange={e =>
                              updateSelectedLayer({
                                shapeType: e.target.value as any,
                              })
                            }
                            className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1"
                          >
                            <option value="rectangle">Rectangle</option>
                            <option value="circle">Circle</option>
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-[var(--color-pib-text-muted)]">Fill Color</label>
                            <div className="flex gap-2 mt-1">
                              <input aria-label="Fill Color"
                                type="color"
                                value={selectedLayer.fillColor}
                                onChange={e =>
                                  updateSelectedLayer({ fillColor: e.target.value })
                                }
                                className="w-10 h-8 rounded border border-[var(--color-pib-line)] cursor-pointer"
                              />
                              <input
                                aria-label="Fill color"
                                type="text"
                                value={selectedLayer.fillColor}
                                onChange={e =>
                                  updateSelectedLayer({ fillColor: e.target.value })
                                }
                                className="flex-1 bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-[var(--color-pib-text-muted)]">Stroke Color</label>
                            <div className="flex gap-2 mt-1">
                              <input
                                aria-label="Stroke color picker"
                                type="color"
                                value={selectedLayer.strokeColor}
                                onChange={e =>
                                  updateSelectedLayer({ strokeColor: e.target.value })
                                }
                                className="w-10 h-8 rounded border border-[var(--color-pib-line)] cursor-pointer"
                              />
                              <input
                                aria-label="Stroke color"
                                type="text"
                                value={selectedLayer.strokeColor}
                                onChange={e =>
                                  updateSelectedLayer({ strokeColor: e.target.value })
                                }
                                className="flex-1 bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm"
                              />
                            </div>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-[var(--color-pib-text-muted)]">Stroke Width</label>
                          <input
                            aria-label="Stroke width"
                            type="number"
                            value={selectedLayer.strokeWidth}
                            onChange={e =>
                              updateSelectedLayer({
                                strokeWidth: parseInt(e.target.value),
                              })
                            }
                            className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[var(--color-pib-text-muted)]">Opacity</label>
                          <input
                            aria-label="Shape opacity"
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={selectedLayer.opacity}
                            onChange={e =>
                              updateSelectedLayer({
                                opacity: parseFloat(e.target.value),
                              })
                            }
                            className="w-full"
                          />
                          <div className="text-xs text-[var(--color-pib-text-faint)] mt-1">
                            {Math.round(selectedLayer.opacity * 100)}%
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="pib-card p-4 bg-[var(--color-pib-bg)] border border-[var(--color-pib-line)] text-center text-[var(--color-pib-text-muted)]">
                <p className="text-sm">Select a layer to edit properties</p>
              </div>
            )}

            {/* Export settings */}
            <div className="pib-card p-4 bg-[var(--color-pib-bg)] border border-[var(--color-pib-line)]">
              <h3 className="text-sm font-medium text-[var(--color-pib-rose)] mb-4">Export</h3>
              <div>
                <label className="text-xs text-[var(--color-pib-text-muted)]">File Name</label>
                <input
                  aria-label="Export file name"
                  type="text"
                  value={exportName}
                  onChange={e => setExportName(e.target.value)}
                  placeholder="design"
                  className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded px-2 py-1 text-sm mt-1"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input data-impeccable-disable="content-invisible-at-rest" aria-label="Upload file"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
      />
    </div>
  )
}
