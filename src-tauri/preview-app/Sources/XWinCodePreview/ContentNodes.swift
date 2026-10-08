import SwiftUI
import UIKit

struct ImageNode: View {
    let node: ViewNode

    var body: some View {
        let resizable = node.has("resizable")
        if let image = node.image {
            if resizable {
                Image(uiImage: image).resizable()
            } else {
                Image(uiImage: image)
            }
        } else if let symbol = node.string("system") {
            if resizable {
                Image(systemName: symbol).resizable()
            } else {
                Image(systemName: symbol)
            }
        } else {
            AssetPlaceholder(resizable: resizable)
        }
    }
}

struct AssetPlaceholder: View {
    let resizable: Bool

    var body: some View {
        let box = RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(Color(uiColor: .secondarySystemFill))
            .overlay {
                Image(systemName: "photo")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(Color(uiColor: .secondaryLabel))
            }
        if resizable {
            box.frame(idealWidth: 120, idealHeight: 90)
        } else {
            box.frame(width: 120, height: 90)
        }
    }
}

struct LabelNode: View {
    let node: ViewNode
    let depth: Int

    var body: some View {
        Label {
            if node.label.isEmpty {
                RichText.make(node.string("title") ?? "")
            } else {
                NodeList(nodes: node.label, depth: depth + 1)
            }
        } icon: {
            if !node.children.isEmpty {
                NodeList(nodes: node.children, depth: depth + 1)
            } else if let symbol = node.string("system") {
                Image(systemName: symbol)
            }
        }
    }
}

struct ShapeNode: View {
    let node: ViewNode

    var body: some View {
        switch node.type {
        case "RoundedRectangle":
            painted(RoundedRectangle(cornerRadius: node.length("radius") ?? 0))
        case "Circle":
            painted(Circle())
        case "Capsule":
            painted(Capsule())
        case "Ellipse":
            painted(Ellipse())
        default:
            painted(Rectangle())
        }
    }

    @ViewBuilder
    private func painted<S: Shape>(_ shape: S) -> some View {
        let fill = node.mod("fill").flatMap { Palette.style($0.fields["color"]) }
        if let stroke = node.mod("stroke") {
            let style = Palette.style(stroke.fields["color"]) ?? AnyShapeStyle(.foreground)
            let width = max(stroke.value("width", default: 1), 0)
            if let fill {
                shape.fill(fill).stroke(style, lineWidth: width)
            } else {
                shape.stroke(style, lineWidth: width)
            }
        } else {
            shape.fill(fill ?? AnyShapeStyle(.foreground))
        }
    }
}

struct UnsupportedBox: View {
    let name: String

    var body: some View {
        Text(verbatim: name)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .overlay {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(Color.gray, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            }
    }
}

enum Primitives {
    struct Parts {
        var title: String?
        var symbol: String?
        var image: UIImage?
    }

    static func extract(_ nodes: [ViewNode]) -> Parts {
        var parts = Parts()
        var stack = Array(nodes.reversed())
        var visited = 0
        while let node = stack.popLast(), visited < 256 {
            visited += 1
            switch node.type {
            case "Text":
                if parts.title == nil {
                    parts.title = node.string("text")
                }
            case "Label":
                if parts.title == nil {
                    parts.title = node.string("title")
                }
                if parts.symbol == nil, parts.image == nil {
                    parts.symbol = node.string("system")
                }
            case "Image":
                if parts.symbol == nil, parts.image == nil {
                    parts.symbol = node.string("system")
                    parts.image = node.image
                }
            default:
                break
            }
            stack.append(contentsOf: (node.label + node.children).reversed())
        }
        return parts
    }

    @ViewBuilder
    static func label(_ nodes: [ViewNode], fallback: String = "") -> some View {
        let parts = extract(nodes)
        let title = parts.title ?? fallback
        if let image = parts.image {
            Label {
                Text(verbatim: title)
            } icon: {
                Image(uiImage: image)
            }
        } else if let symbol = parts.symbol {
            Label(title, systemImage: symbol)
        } else {
            Text(verbatim: title)
        }
    }
}
