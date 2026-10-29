// Draws icons/studio.png, Studio's neutral 1024x1024 app icon: a dark
// rounded square with a white frame and play mark. The icon is one for both
// brands (an app icon is fixed at build time), so it carries no letter.
//
//     swift icons/make-studio-icon.swift icons/studio.png
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let output = CommandLine.arguments.dropFirst().first ?? "icons/studio.png"
let size = 1024
let space = CGColorSpace(name: CGColorSpace.sRGB)!
guard let context = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else { fatalError("no context") }

func colour(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(
        srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
        blue: CGFloat(hex & 0xFF) / 255, alpha: alpha
    )
}

// The macOS icon grid: an 824-point square, centred, with room for a shadow.
let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
let tilePath = CGPath(roundedRect: tile, cornerWidth: 186, cornerHeight: 186, transform: nil)

context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -10), blur: 28, color: colour(0x000000, 0.35))
context.addPath(tilePath)
context.setFillColor(colour(0x1C1D21))
context.fillPath()
context.restoreGState()

// A soft top-to-bottom gradient over the tile.
context.saveGState()
context.addPath(tilePath)
context.clip()
let gradient = CGGradient(colorsSpace: space, colors: [colour(0x34363D), colour(0x141518)] as CFArray, locations: [0, 1])!
context.drawLinearGradient(gradient, start: CGPoint(x: 512, y: tile.maxY), end: CGPoint(x: 512, y: tile.minY), options: [])
context.restoreGState()

// The frame: a 16:10 rounded rectangle outline.
let frame = CGRect(x: 512 - 290, y: 512 - 182, width: 580, height: 364)
context.addPath(CGPath(roundedRect: frame, cornerWidth: 64, cornerHeight: 64, transform: nil))
context.setStrokeColor(colour(0xFFFFFF))
context.setLineWidth(40)
context.strokePath()

// The play mark, a rounded triangle nudged right so it looks centred.
let play = CGMutablePath()
let centre = CGPoint(x: 524, y: 512)
let height: CGFloat = 176
let width = height * 0.9
play.move(to: CGPoint(x: centre.x - width / 2, y: centre.y + height / 2))
play.addLine(to: CGPoint(x: centre.x + width / 2, y: centre.y))
play.addLine(to: CGPoint(x: centre.x - width / 2, y: centre.y - height / 2))
play.closeSubpath()
context.addPath(play)
context.setFillColor(colour(0xFFFFFF))
context.setStrokeColor(colour(0xFFFFFF))
context.setLineWidth(22)
context.setLineJoin(.round)
context.drawPath(using: .fillStroke)

guard let image = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: output) as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fatalError("can't write \(output)") }
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("can't write \(output)") }
print("Wrote \(output)")
