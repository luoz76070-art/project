// Native macOS SVG rasterization; no Flutter or third-party dependencies.
import AppKit

struct Job: Decodable {
    let source: String
    let output: String
    let size: Int
}

let jobs = try JSONDecoder().decode([Job].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
for job in jobs {
    guard let image = NSImage(contentsOfFile: job.source),
          let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: job.size, pixelsHigh: job.size,
                                        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
          let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        fatalError("Cannot render \(job.source)")
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.cgContext.clear(CGRect(x: 0, y: 0, width: job.size, height: job.size))
    context.imageInterpolation = .high
    image.draw(in: NSRect(x: 0, y: 0, width: job.size, height: job.size))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("PNG encoding failed") }
    try png.write(to: URL(fileURLWithPath: job.output))
}
