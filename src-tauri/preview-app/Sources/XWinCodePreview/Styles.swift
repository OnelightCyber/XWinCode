import CryptoKit
import SwiftUI
import UIKit

enum Palette {
    static func color(_ value: JSONValue?) -> Color? {
        guard let spec = value?.object else { return nil }
        if let light = rgba(spec["rgba"]) {
            guard let dark = rgba(spec["dark"]) else { return Color(uiColor: light) }
            return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
        }
        guard let name = spec["name"]?.string else { return nil }
        let base = named(name)
        guard let opacity = spec["opacity"]?.number else { return base }
        return base.opacity(min(max(opacity, 0), 1))
    }

    static func rgba(_ value: JSONValue?) -> UIColor? {
        guard let parts = value?.array else { return nil }
        let channels = parts.map { CGFloat(min(max($0.number ?? 0, 0), 1)) }
        guard channels.count >= 3 else { return nil }
        return UIColor(red: channels[0], green: channels[1], blue: channels[2], alpha: channels.count > 3 ? channels[3] : 1)
    }

    static func style(_ value: JSONValue?) -> AnyShapeStyle? {
        if let spec = value?.object, spec["rgba"] == nil, let name = spec["name"]?.string,
           name == "primary" || name == "secondary" {
            let base: HierarchicalShapeStyle = name == "primary" ? .primary : .secondary
            guard let opacity = spec["opacity"]?.number else { return AnyShapeStyle(base) }
            return AnyShapeStyle(base.opacity(min(max(opacity, 0), 1)))
        }
        return color(value).map { AnyShapeStyle($0) }
    }

    static func named(_ name: String) -> Color {
        switch name {
        case "primary": return .primary
        case "secondary": return .secondary
        case "red": return .red
        case "orange": return .orange
        case "yellow": return .yellow
        case "green": return .green
        case "mint": return .mint
        case "teal": return .teal
        case "cyan": return .cyan
        case "blue": return .blue
        case "indigo": return .indigo
        case "purple": return .purple
        case "pink": return .pink
        case "brown": return .brown
        case "gray": return .gray
        case "black": return .black
        case "white": return .white
        case "clear": return .clear
        case "accentColor": return .accentColor
        case "systemBackground": return Color(uiColor: .systemBackground)
        case "secondarySystemBackground": return Color(uiColor: .secondarySystemBackground)
        case "tertiarySystemBackground": return Color(uiColor: .tertiarySystemBackground)
        case "systemGroupedBackground": return Color(uiColor: .systemGroupedBackground)
        case "secondarySystemGroupedBackground": return Color(uiColor: .secondarySystemGroupedBackground)
        case "label": return Color(uiColor: .label)
        case "secondaryLabel": return Color(uiColor: .secondaryLabel)
        case "tertiaryLabel": return Color(uiColor: .tertiaryLabel)
        case "separator": return Color(uiColor: .separator)
        case "systemFill": return Color(uiColor: .systemFill)
        default: return .gray
        }
    }

    static func material(_ name: String?) -> Material? {
        switch name {
        case "ultraThin": return .ultraThinMaterial
        case "thin": return .thinMaterial
        case "regular": return .regularMaterial
        case "thick": return .thickMaterial
        case "ultraThick": return .ultraThickMaterial
        case "bar": return .bar
        default: return nil
        }
    }
}

enum Typography {
    static func font(_ value: JSONValue?) -> Font? {
        guard let spec = value?.object else { return nil }
        let fontWeight = weight(spec["weight"]?.string)
        let fontDesign = design(spec["design"]?.string)
        var font: Font
        if let custom = spec["custom"]?.string, !custom.isEmpty {
            let style = textStyle(spec["style"]?.string)
            if let size = spec["size"]?.number, size > 0 {
                font = .custom(custom, size: CGFloat(min(size, 1000)), relativeTo: style)
            } else {
                font = .custom(custom, size: UIFont.preferredFont(forTextStyle: uiTextStyle(spec["style"]?.string)).pointSize, relativeTo: style)
            }
            if let fontWeight {
                font = font.weight(fontWeight)
            }
        } else if let size = spec["size"]?.number, size > 0 {
            font = .system(size: CGFloat(min(size, 1000)), weight: fontWeight, design: fontDesign)
        } else {
            font = .system(textStyle(spec["style"]?.string), design: fontDesign, weight: fontWeight)
        }
        if spec["italic"]?.bool == true {
            font = font.italic()
        }
        return font
    }

    static func uiTextStyle(_ name: String?) -> UIFont.TextStyle {
        switch name {
        case "largeTitle": return .largeTitle
        case "title": return .title1
        case "title2": return .title2
        case "title3": return .title3
        case "headline": return .headline
        case "subheadline": return .subheadline
        case "callout": return .callout
        case "footnote": return .footnote
        case "caption": return .caption1
        case "caption2": return .caption2
        default: return .body
        }
    }

    static func dynamicType(_ name: String?) -> DynamicTypeSize? {
        switch name {
        case "xSmall": return .xSmall
        case "small": return .small
        case "medium": return .medium
        case "large": return .large
        case "xLarge": return .xLarge
        case "xxLarge": return .xxLarge
        case "xxxLarge": return .xxxLarge
        case "accessibility1": return .accessibility1
        case "accessibility2": return .accessibility2
        case "accessibility3": return .accessibility3
        case "accessibility4": return .accessibility4
        case "accessibility5": return .accessibility5
        default: return nil
        }
    }

    static func textStyle(_ name: String?) -> Font.TextStyle {
        switch name {
        case "largeTitle": return .largeTitle
        case "title": return .title
        case "title2": return .title2
        case "title3": return .title3
        case "headline": return .headline
        case "subheadline": return .subheadline
        case "callout": return .callout
        case "footnote": return .footnote
        case "caption": return .caption
        case "caption2": return .caption2
        default: return .body
        }
    }

    static func weight(_ name: String?) -> Font.Weight? {
        switch name {
        case "ultraLight": return .ultraLight
        case "thin": return .thin
        case "light": return .light
        case "regular": return .regular
        case "medium": return .medium
        case "semibold": return .semibold
        case "bold": return .bold
        case "heavy": return .heavy
        case "black": return .black
        default: return nil
        }
    }

    static func design(_ name: String?) -> Font.Design? {
        switch name {
        case "default": return .default
        case "rounded": return .rounded
        case "monospaced": return .monospaced
        case "serif": return .serif
        default: return nil
        }
    }
}

enum ShapeKind {
    static func make(_ value: JSONValue?) -> AnyShape? {
        guard let spec = value?.object else { return nil }
        switch spec["shape"]?.string {
        case "rect":
            return AnyShape(Rectangle())
        case "roundedRect":
            let radius = CGFloat(min(max(spec["radius"]?.number ?? 0, 0), 100_000))
            return AnyShape(RoundedRectangle(cornerRadius: radius))
        case "circle":
            return AnyShape(Circle())
        case "capsule":
            return AnyShape(Capsule())
        case "ellipse":
            return AnyShape(Ellipse())
        default:
            return nil
        }
    }
}

enum Layout {
    static func alignment(_ name: String?) -> Alignment {
        switch name {
        case "leading": return .leading
        case "trailing": return .trailing
        case "top": return .top
        case "bottom": return .bottom
        case "topLeading": return .topLeading
        case "topTrailing": return .topTrailing
        case "bottomLeading": return .bottomLeading
        case "bottomTrailing": return .bottomTrailing
        default: return .center
        }
    }

    static func horizontal(_ name: String?) -> HorizontalAlignment {
        switch name {
        case "leading": return .leading
        case "trailing": return .trailing
        default: return .center
        }
    }

    static func vertical(_ name: String?) -> VerticalAlignment {
        switch name {
        case "top": return .top
        case "bottom": return .bottom
        case "firstTextBaseline": return .firstTextBaseline
        case "lastTextBaseline": return .lastTextBaseline
        default: return .center
        }
    }

    static func text(_ name: String?) -> TextAlignment {
        switch name {
        case "leading": return .leading
        case "trailing": return .trailing
        default: return .center
        }
    }
}

enum RichText {
    private static let markers: Set<Character> = ["*", "_", "~", "`", "["]

    static func make(_ string: String) -> Text {
        if string.contains(where: { markers.contains($0) }),
           let attributed = try? AttributedString(
               markdown: string,
               options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
           ) {
            return Text(attributed)
        }
        return Text(verbatim: string)
    }
}

enum Motion {
    static func animation(_ value: JSONValue?) -> Animation {
        guard let spec = value?.object else { return .default }
        let duration = spec["duration"]?.number.map { min(max($0, 0.01), 10) }
        let bounce = spec["bounce"]?.number.map { min(max($0, -1), 1) } ?? 0
        switch spec["kind"]?.string {
        case "linear": return .linear(duration: duration ?? 0.35)
        case "easeIn": return .easeIn(duration: duration ?? 0.35)
        case "easeOut": return .easeOut(duration: duration ?? 0.35)
        case "easeInOut": return .easeInOut(duration: duration ?? 0.35)
        case "spring", "interpolatingSpring", "interactiveSpring": return .spring(duration: duration ?? 0.5, bounce: bounce)
        case "bouncy": return .bouncy(duration: duration ?? 0.5, extraBounce: bounce)
        case "snappy": return .snappy(duration: duration ?? 0.5, extraBounce: bounce)
        case "smooth": return .smooth(duration: duration ?? 0.5, extraBounce: bounce)
        default: return .default
        }
    }

    static func transition(_ kind: String?, edge: String?) -> AnyTransition {
        let side: Edge
        switch edge {
        case "top": side = .top
        case "bottom": side = .bottom
        case "trailing": side = .trailing
        default: side = .leading
        }
        switch kind {
        case "scale": return .scale
        case "slide": return .slide
        case "move": return .move(edge: side)
        case "push": return .push(from: side)
        case "identity": return .identity
        default: return .opacity
        }
    }
}

@MainActor
enum FontStore {
    private static var registered: [CGFont] = []
    private static var signature: [SHA256.Digest] = []

    static func register(_ fonts: [JSONValue]) -> Bool {
        var files: [Data] = []
        for item in fonts.prefix(32) {
            guard let text = item["data"]?.string, let comma = text.firstIndex(of: ",") else { continue }
            guard let data = Data(base64Encoded: String(text[text.index(after: comma)...]), options: .ignoreUnknownCharacters),
                  data.count < 20 * 1024 * 1024 else { continue }
            files.append(data)
        }
        let digests = files.map { SHA256.hash(data: $0) }
        guard digests != signature else { return false }
        for font in registered {
            CTFontManagerUnregisterGraphicsFont(font, nil)
        }
        registered = []
        for data in files {
            guard let provider = CGDataProvider(data: data as CFData), let font = CGFont(provider) else { continue }
            if CTFontManagerRegisterGraphicsFont(font, nil) {
                registered.append(font)
            }
        }
        signature = digests
        return true
    }
}
