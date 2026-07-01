import AppKit
import AVFoundation
import CoreGraphics
import Foundation

let outputPath = CommandLine.arguments.dropFirst().first ?? "pib-proof-pack-short.mp4"
let outputURL = URL(fileURLWithPath: outputPath)
try? FileManager.default.removeItem(at: outputURL)

let outputWidth = 720
let outputHeight = 1280
let canvasWidth: CGFloat = 1080
let canvasHeight: CGFloat = 1920
let fps: Int32 = 30
let durationSeconds = 27
let totalFrames = Int(fps) * durationSeconds

let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let settings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: outputWidth,
  AVVideoHeightKey: outputHeight,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: 1_150_000,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
  ],
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false

let attributes: [String: Any] = [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
  kCVPixelBufferWidthKey as String: outputWidth,
  kCVPixelBufferHeightKey as String: outputHeight,
  kCVPixelBufferCGImageCompatibilityKey as String: true,
  kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
]
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attributes)

guard writer.canAdd(input) else {
  fatalError("Cannot add video input")
}
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

let colorSpace = CGColorSpaceCreateDeviceRGB()
let bgTop = NSColor(calibratedRed: 0.05, green: 0.08, blue: 0.11, alpha: 1)
let bgBottom = NSColor(calibratedRed: 0.91, green: 0.96, blue: 0.93, alpha: 1)
let ink = NSColor(calibratedRed: 0.03, green: 0.06, blue: 0.08, alpha: 1)
let white = NSColor.white
let accent = NSColor(calibratedRed: 0.04, green: 0.68, blue: 0.54, alpha: 1)
let gold = NSColor(calibratedRed: 0.94, green: 0.70, blue: 0.22, alpha: 1)

struct Scene {
  let start: Double
  let end: Double
  let headline: String
  let subline: String
  let badge: String
}

let scenes = [
  Scene(start: 0, end: 3.4, headline: "Stop asking for dashboards.", subline: "Ask your AI employee for a decision loop.", badge: "CEO OPERATING NOTE"),
  Scene(start: 3.4, end: 8.0, headline: "1. Is the data stored?", subline: "CRM, Marketing Studio, tasks, and proof all need to live in the database.", badge: "STORE"),
  Scene(start: 8.0, end: 13.0, headline: "2. Can the agent gather it again tomorrow?", subline: "Reusable skills beat stale dashboard pages.", badge: "GATHER"),
  Scene(start: 13.0, end: 18.6, headline: "3. What decision does it support today?", subline: "The answer belongs in dynamic chat with approval gates.", badge: "DECIDE"),
  Scene(start: 18.6, end: 23.4, headline: "Partners in Biz turns agents into operators.", subline: "Store -> Gather -> Decide -> Approve.", badge: "OPERATE"),
  Scene(start: 23.4, end: 27.0, headline: "No dashboard debt.", subline: "On-demand evidence. Daily growth action.", badge: "PARTNERS IN BIZ"),
]

func lerp(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat {
  return a + (b - a) * max(0, min(1, t))
}

func roundedRect(_ rect: CGRect, radius: CGFloat, color: NSColor, context: CGContext) {
  context.setFillColor(color.cgColor)
  let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
  context.addPath(path)
  context.fillPath()
}

func drawText(_ text: String, rect: CGRect, size: CGFloat, weight: NSFont.Weight, color: NSColor, alignment: NSTextAlignment = .left, lineHeight: CGFloat? = nil) {
  let paragraph = NSMutableParagraphStyle()
  paragraph.alignment = alignment
  paragraph.lineBreakMode = .byWordWrapping
  if let lineHeight {
    paragraph.minimumLineHeight = lineHeight
    paragraph.maximumLineHeight = lineHeight
  }
  let attrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: size, weight: weight),
    .foregroundColor: color,
    .paragraphStyle: paragraph,
    .kern: 0,
  ]
  (text as NSString).draw(in: rect, withAttributes: attrs)
}

func drawFrame(index: Int, into buffer: CVPixelBuffer) {
  CVPixelBufferLockBaseAddress(buffer, [])
  defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

  guard let base = CVPixelBufferGetBaseAddress(buffer) else { return }
  let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
  guard let context = CGContext(
    data: base,
    width: outputWidth,
    height: outputHeight,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
  ) else { return }

  let progress = Double(index) / Double(totalFrames - 1)
  let time = progress * Double(durationSeconds)
  let scene = scenes.first(where: { time >= $0.start && time < $0.end }) ?? scenes.last!
  let local = CGFloat((time - scene.start) / max(0.01, scene.end - scene.start))
  let eased = 1 - pow(1 - local, 3)

  let gradient = CGGradient(colorsSpace: colorSpace, colors: [bgBottom.cgColor, bgTop.cgColor] as CFArray, locations: [0, 1])!
  context.scaleBy(x: CGFloat(outputWidth) / canvasWidth, y: CGFloat(outputHeight) / canvasHeight)
  context.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 0, y: canvasHeight), options: [])

  context.setFillColor(NSColor(calibratedWhite: 1, alpha: 0.16).cgColor)
  for i in 0..<7 {
    let y = CGFloat(260 + i * 190) + CGFloat(sin(progress * 5 + Double(i)) * 22)
    context.fill(CGRect(x: 88, y: y, width: 904, height: 3))
  }

  let cardOffset = lerp(80, 0, eased)
  roundedRect(CGRect(x: 74, y: 310 - cardOffset, width: 932, height: 1040), radius: 34, color: NSColor(calibratedWhite: 1, alpha: 0.92), context: context)
  roundedRect(CGRect(x: 112, y: 384 - cardOffset, width: 300, height: 72), radius: 20, color: accent, context: context)
  roundedRect(CGRect(x: 438, y: 384 - cardOffset, width: 184, height: 72), radius: 20, color: gold, context: context)

  let nsContext = NSGraphicsContext(cgContext: context, flipped: false)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = nsContext
  drawText(scene.badge, rect: CGRect(x: 136, y: 404 - cardOffset, width: 252, height: 40), size: 24, weight: .bold, color: white, alignment: .center)
  drawText("AI CEO", rect: CGRect(x: 466, y: 404 - cardOffset, width: 128, height: 40), size: 24, weight: .bold, color: ink, alignment: .center)
  drawText(scene.headline, rect: CGRect(x: 120, y: 540 - cardOffset, width: 840, height: 250), size: 76, weight: .heavy, color: ink, lineHeight: 84)
  drawText(scene.subline, rect: CGRect(x: 124, y: 810 - cardOffset, width: 820, height: 210), size: 43, weight: .medium, color: NSColor(calibratedRed: 0.18, green: 0.24, blue: 0.27, alpha: 1), lineHeight: 54)
  drawText("Store  ->  Gather  ->  Decide  ->  Approve", rect: CGRect(x: 124, y: 1130 - cardOffset, width: 820, height: 62), size: 32, weight: .semibold, color: accent, alignment: .center)
  drawText("partnersinbiz.online", rect: CGRect(x: 124, y: 1252 - cardOffset, width: 820, height: 46), size: 28, weight: .medium, color: NSColor(calibratedWhite: 0.28, alpha: 1), alignment: .center)
  NSGraphicsContext.restoreGraphicsState()

  let dotCount = min(4, max(1, Int(time / 6.8) + 1))
  for i in 0..<4 {
    let active = i < dotCount
    roundedRect(CGRect(x: 270 + i * 145, y: 1450, width: 108, height: 18), radius: 9, color: active ? gold : NSColor(calibratedWhite: 1, alpha: 0.35), context: context)
  }
}

var frame = 0
let queue = DispatchQueue(label: "pib.video.writer")
input.requestMediaDataWhenReady(on: queue) {
  while input.isReadyForMoreMediaData && frame < totalFrames {
    guard let pool = adaptor.pixelBufferPool else { fatalError("Missing pixel buffer pool") }
    var pixelBuffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer)
    guard let buffer = pixelBuffer else { fatalError("Could not create pixel buffer") }
    drawFrame(index: frame, into: buffer)
    let time = CMTime(value: CMTimeValue(frame), timescale: fps)
    adaptor.append(buffer, withPresentationTime: time)
    frame += 1
  }
  if frame >= totalFrames {
    input.markAsFinished()
    writer.finishWriting {
      if writer.status == .failed {
        let errorMessage = writer.error?.localizedDescription ?? "unknown"
        fputs("Writer failed: \(errorMessage)\n", stderr)
        exit(1)
      }
      exit(0)
    }
  }
}

RunLoop.main.run()
