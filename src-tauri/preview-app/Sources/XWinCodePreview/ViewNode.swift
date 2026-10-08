import ImageIO
import UIKit

struct ViewNode: Identifiable {
    static let maxDepth = 64

    var id: String
    let type: String
    let props: [String: JSONValue]
    let children: [ViewNode]
    let label: [ViewNode]
    let mods: [Mod]
    let event: String?
    let image: UIImage?
    let options: [PickerOption]
    let schemed: Bool
}

struct Mod {
    let kind: String
    let fields: [String: JSONValue]
    let nodes: [ViewNode]
}

struct PickerOption: Identifiable {
    let id: Int
    let tag: JSONValue
    let label: [ViewNode]
}

extension ViewNode {
    static func root(_ value: JSONValue) -> ViewNode? {
        parse(value, fallback: "root", depth: 0)
    }

    private static func parse(_ value: JSONValue, fallback: String, depth: Int) -> ViewNode? {
        guard let object = value.object else { return nil }
        let rawID = object["id"]?.text ?? ""
        let id = rawID.isEmpty ? fallback : rawID
        let type = object["type"]?.string ?? "Unsupported"
        let props = object["props"]?.object ?? [:]
        let nested = depth <= maxDepth
        let next = depth + 1
        let children = nested ? list(object["children"], parent: id, slot: "c", depth: next) : []
        let label = nested ? list(object["label"], parent: id, slot: "l", depth: next) : []
        var mods: [Mod] = []
        for (index, item) in (object["mods"]?.array ?? []).enumerated() {
            guard let fields = item.object, let kind = fields["m"]?.string else { continue }
            let source = kind == "tabItem" ? fields["label"] : fields["view"]
            let nodes = nested ? list(source, parent: id, slot: "m\(index).", depth: next) : []
            mods.append(Mod(kind: kind, fields: fields, nodes: nodes))
        }
        let options = type == "Picker" && nested ? pickerOptions(props["options"], parent: id, depth: next) : []
        let image = type == "Image" ? decodeImage(props) : nil
        let event = object["event"]?.text
        let schemed = mods.contains { $0.kind == "scheme" || $0.nodes.contains { $0.schemed } }
            || children.contains { $0.schemed }
            || label.contains { $0.schemed }
        return ViewNode(
            id: id,
            type: type,
            props: props,
            children: children,
            label: label,
            mods: mods,
            event: event?.isEmpty == false ? event : nil,
            image: image,
            options: options,
            schemed: schemed
        )
    }

    private static func list(_ value: JSONValue?, parent: String, slot: String, depth: Int) -> [ViewNode] {
        guard let items = value?.array else { return [] }
        var seen = Set<String>()
        var nodes: [ViewNode] = []
        nodes.reserveCapacity(items.count)
        for (index, item) in items.enumerated() {
            guard var node = parse(item, fallback: "\(parent)/\(slot)\(index)", depth: depth) else { continue }
            if seen.contains(node.id) {
                var candidate = "\(node.id)#\(index)"
                while seen.contains(candidate) {
                    candidate += "+"
                }
                node.id = candidate
            }
            seen.insert(node.id)
            nodes.append(node)
        }
        return nodes
    }

    private static func pickerOptions(_ value: JSONValue?, parent: String, depth: Int) -> [PickerOption] {
        guard let items = value?.array else { return [] }
        var options: [PickerOption] = []
        for (index, item) in items.enumerated() {
            guard let fields = item.object else { continue }
            let label = list(fields["label"], parent: parent, slot: "o\(index).", depth: depth)
            options.append(PickerOption(id: index, tag: fields["tag"] ?? .null, label: label))
        }
        return options
    }

    private static func decodeImage(_ props: [String: JSONValue]) -> UIImage? {
        guard let source = props["src"]?.string, !source.isEmpty else { return nil }
        var payload = Substring(source)
        if source.hasPrefix("data:") {
            guard let comma = source.firstIndex(of: ",") else { return nil }
            payload = source[source.index(after: comma)...]
        }
        guard let data = Data(base64Encoded: String(payload), options: .ignoreUnknownCharacters),
              let imageSource = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: 4096,
        ]
        guard let bitmap = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, options as CFDictionary) else { return nil }
        let scale = min(max(props["scale"]?.number ?? 1, 1), 4)
        return UIImage(cgImage: bitmap, scale: CGFloat(scale), orientation: .up)
    }
}

extension ViewNode {
    func string(_ key: String) -> String? {
        props[key]?.text
    }

    func number(_ key: String) -> Double? {
        props[key]?.number
    }

    func bool(_ key: String) -> Bool? {
        props[key]?.bool
    }

    func length(_ key: String) -> CGFloat? {
        number(key).map { CGFloat(min(max($0, 0), 100_000)) }
    }

    func offset(_ key: String) -> CGFloat? {
        number(key).map { CGFloat(min(max($0, -100_000), 100_000)) }
    }

    func mod(_ kind: String) -> Mod? {
        mods.first { $0.kind == kind }
    }

    func has(_ kind: String) -> Bool {
        mods.contains { $0.kind == kind }
    }
}

extension Mod {
    func string(_ key: String) -> String? {
        fields[key]?.text
    }

    func number(_ key: String) -> Double? {
        fields[key]?.number
    }

    func value(_ key: String, default fallback: Double = 0) -> CGFloat {
        CGFloat(min(max(number(key) ?? fallback, -100_000), 100_000))
    }

    func size(_ key: String) -> CGFloat? {
        number(key).map { CGFloat(min(max($0, 0), 100_000)) }
    }

    func limit(_ key: String) -> CGFloat? {
        if fields[key]?.string == "inf" { return .infinity }
        return size(key)
    }
}
