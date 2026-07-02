'use client'

import { useState } from 'react'
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  type ReactFlowProps,
} from '@xyflow/react'
// @xyflow/react/dist/style.css is imported globally in app/layout.tsx.
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import ZoomRail from '@/components/creative-canvas/canvas/ZoomRail'
import BottomToolbar, { type CanvasTool } from '@/components/creative-canvas/canvas/BottomToolbar'

export interface CanvasStageProps {
  nodes: Node[]
  edges: Edge[]
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  onNodeClick?: NodeMouseHandler
  nodeTypes?: NodeTypes
  /** Called with the flow position of a double-click on the empty pane. */
  onPaneDoubleClick?: (flowPosition: { x: number; y: number }, clientXY: { x: number; y: number }) => void
  /** Called with the flow position of a right-click on the empty pane. */
  onPaneContextMenu?: (flowPosition: { x: number; y: number }, clientXY: { x: number; y: number }) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  activeTool: CanvasTool
  onTool: (tool: CanvasTool) => void
  children?: React.ReactNode
}

function StageInner(props: CanvasStageProps) {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onNodeClick,
    nodeTypes,
    onPaneDoubleClick,
    onPaneContextMenu,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    activeTool,
    onTool,
    children,
  } = props

  const { screenToFlowPosition } = useReactFlow()

  const handleDoubleClick: ReactFlowProps['onDoubleClick'] = (event) => {
    if (!onPaneDoubleClick) return
    // Only react to double-clicks on the empty pane, not on nodes/edges.
    if (!(event.target as HTMLElement).classList.contains('react-flow__pane')) return
    const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    onPaneDoubleClick(flow, { x: event.clientX, y: event.clientY })
  }

  const handleContextMenu: ReactFlowProps['onPaneContextMenu'] = (event) => {
    if (!onPaneContextMenu) return
    event.preventDefault()
    const e = event as unknown as MouseEvent
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    onPaneContextMenu(flow, { x: e.clientX, y: e.clientY })
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: canvasTheme.bg }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        colorMode="dark"
        connectionLineType={'bezier' as ReactFlowProps['connectionLineType']}
        defaultEdgeOptions={{ type: 'default', animated: false }}
        selectionOnDrag={activeTool === 'select'}
        panOnDrag={activeTool === 'select' ? [1, 2] : true}
        selectionMode={SelectionMode.Partial}
        onDoubleClick={handleDoubleClick}
        onPaneContextMenu={handleContextMenu}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} color={canvasTheme.bgGridDot} gap={22} size={1.5} />
        <MiniMap
          pannable
          zoomable
          style={{ background: canvasTheme.surface, border: `1px solid ${canvasTheme.border}` }}
          maskColor="rgba(0,0,0,0.55)"
          nodeColor={canvasTheme.accent}
        />
      </ReactFlow>
      <ZoomRail canUndo={canUndo} canRedo={canRedo} onUndo={onUndo} onRedo={onRedo} />
      <BottomToolbar activeTool={activeTool} onTool={onTool} />
      {children}
    </div>
  )
}

/** Full-bleed dark Higgsfield-style canvas stage with overlay rail + toolbar. */
export default function CanvasStage(props: CanvasStageProps) {
  return (
    <ReactFlowProvider>
      <StageInner {...props} />
    </ReactFlowProvider>
  )
}

export type { CanvasTool }
