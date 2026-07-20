'use client'

import { useEffect, useRef } from 'react'

/**
 * WebGL2 neural-field atmosphere for Messages.
 * Pure WebGL (no three.js) — soft volumetric aurora + drifting signal nodes.
 * Fully disabled under prefers-reduced-motion and when WebGL is unavailable.
 */

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_accent;
uniform vec3 u_violet;
uniform vec3 u_cyan;
uniform float u_intensity;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = v_uv;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  float t = u_time * 0.12;

  // Slow domain warp for living aurora ribbons
  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 + vec2(5.2, 1.3) - t * 0.7));
  vec2 r = vec2(
    fbm(p * 2.1 + 4.0 * q + vec2(1.7, 9.2) + t * 0.35),
    fbm(p * 2.1 + 4.0 * q + vec2(8.3, 2.8) - t * 0.25)
  );
  float n = fbm(p * 1.8 + 3.5 * r);

  // Soft vignette keeps the center readable for chat content
  float vignette = smoothstep(1.35, 0.15, length(p * vec2(1.05, 0.92)));

  // Layered colour fields — amber / violet / cyan (PiB accents)
  vec3 col = vec3(0.015, 0.016, 0.02);
  col += u_accent * (0.22 * smoothstep(0.35, 0.95, n) * (0.55 + 0.45 * sin(t + n * 6.0)));
  col += u_violet * (0.18 * smoothstep(0.2, 0.85, r.x) * (0.4 + 0.6 * q.y));
  col += u_cyan * (0.12 * smoothstep(0.45, 1.0, r.y) * (0.35 + 0.65 * q.x));

  // Drifting signal nodes (constellation of "agents / sessions")
  float nodes = 0.0;
  for (int i = 0; i < 18; i++) {
    float fi = float(i);
    vec2 seed = vec2(hash(vec2(fi, 1.7)), hash(vec2(fi * 2.3, 4.1)));
    vec2 center = seed * 2.0 - 1.0;
    center.x *= u_res.x / u_res.y;
    center += 0.08 * vec2(sin(t * 0.9 + fi), cos(t * 0.7 + fi * 1.3));
    float d = length(p - center * 0.72);
    float pulse = 0.5 + 0.5 * sin(t * 2.4 + fi * 1.7);
    nodes += (0.012 / (d * d + 0.004)) * (0.35 + 0.65 * pulse);
  }
  col += mix(u_cyan, u_accent, 0.45) * min(nodes, 1.4) * 0.08;

  // Fine grain so it feels like a physical panel, not a flat gradient
  float grain = (hash(gl_FragCoord.xy + fract(u_time) * 100.0) - 0.5) * 0.035;
  col += grain;

  float alpha = (0.42 + 0.28 * n) * vignette * u_intensity;
  outColor = vec4(col, clamp(alpha, 0.0, 0.72));
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function parseCssColor(value: string, fallback: [number, number, number]): [number, number, number] {
  const trimmed = value.trim()
  const hex = trimmed.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = Number.parseInt(hex[1], 16)
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  }
  const rgb = trimmed.match(/rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/i)
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255]
  return fallback
}

export function MessagesNeuralField({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof window === 'undefined') return

    const prefersReducedMotion = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
    if (prefersReducedMotion) {
      canvas.dataset.state = 'reduced-motion'
      return
    }

    // jsdom and headless runners often lack WebGL2 — skip without calling getContext
    // so test output stays clean (getContext logs "not implemented" there).
    if (typeof WebGL2RenderingContext === 'undefined') {
      canvas.dataset.state = 'fallback'
      return
    }

    let gl: WebGL2RenderingContext | null = null
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        powerPreference: 'low-power',
      }) as WebGL2RenderingContext | null
    } catch {
      gl = null
    }
    if (!gl) {
      canvas.dataset.state = 'fallback'
      return
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) {
      canvas.dataset.state = 'fallback'
      return
    }

    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      canvas.dataset.state = 'fallback'
      return
    }
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    const uRes = gl.getUniformLocation(program, 'u_res')
    const uTime = gl.getUniformLocation(program, 'u_time')
    const uAccent = gl.getUniformLocation(program, 'u_accent')
    const uViolet = gl.getUniformLocation(program, 'u_violet')
    const uCyan = gl.getUniformLocation(program, 'u_cyan')
    const uIntensity = gl.getUniformLocation(program, 'u_intensity')

    const root = getComputedStyle(document.documentElement)
    const accent = parseCssColor(root.getPropertyValue('--color-pib-accent'), [0.96, 0.65, 0.14])
    const violet = parseCssColor(root.getPropertyValue('--color-pib-violet'), [0.49, 0.36, 1])
    const cyan = parseCssColor(root.getPropertyValue('--color-pib-cyan'), [0.18, 0.83, 0.75])

    gl.uniform3f(uAccent, accent[0], accent[1], accent[2])
    gl.uniform3f(uViolet, violet[0], violet[1], violet[2])
    gl.uniform3f(uCyan, cyan[0], cyan[1], cyan[2])
    gl.uniform1f(uIntensity, 1)

    let raf = 0
    let running = true
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const start = performance.now()

    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) return
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const w = Math.max(1, Math.floor(parent.clientWidth * dpr))
      const h = Math.max(1, Math.floor(parent.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      }
    }

    const onVisibility = () => {
      running = document.visibilityState === 'visible'
      if (running) raf = requestAnimationFrame(frame)
    }

    const frame = (now: number) => {
      if (!running) return
      resize()
      const t = (now - start) / 1000
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uTime, t)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      raf = requestAnimationFrame(frame)
    }

    resize()
    canvas.dataset.state = 'live'
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('resize', resize, { passive: true })
    raf = requestAnimationFrame(frame)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', resize)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buffer)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="messages-neural-field"
      className={`messages-neural-field ${className}`.trim()}
    />
  )
}

export default MessagesNeuralField
