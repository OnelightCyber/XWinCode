import Foundation

enum JSONValue: Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])
}

extension JSONValue {
    static let maxNesting = 400

    var string: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    var number: Double? {
        switch self {
        case .number(let value):
            return value.isFinite ? value : nil
        case .string(let value):
            guard let parsed = Double(value), parsed.isFinite else { return nil }
            return parsed
        default:
            return nil
        }
    }

    var bool: Bool? {
        switch self {
        case .bool(let value):
            return value
        case .number(let value):
            return value != 0
        case .string(let value):
            if value == "true" { return true }
            if value == "false" { return false }
            return nil
        default:
            return nil
        }
    }

    var array: [JSONValue]? {
        if case .array(let value) = self { return value }
        return nil
    }

    var object: [String: JSONValue]? {
        if case .object(let value) = self { return value }
        return nil
    }

    var text: String? {
        switch self {
        case .string(let value):
            return value
        case .number(let value):
            return JSONValue.format(value)
        case .bool(let value):
            return value ? "true" : "false"
        default:
            return nil
        }
    }

    subscript(key: String) -> JSONValue? {
        object?[key]
    }
}

extension JSONValue {
    static func parse(_ data: Data) -> JSONValue? {
        guard nestingWithinLimit(data) else { return nil }
        guard let root = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return nil }
        return JSONValue(foundation: root, depth: 0)
    }

    private init(foundation value: Any, depth: Int) {
        guard depth <= JSONValue.maxNesting else {
            self = .null
            return
        }
        switch value {
        case let text as String:
            self = .string(text)
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                self = .bool(number.boolValue)
            } else {
                self = .number(number.doubleValue)
            }
        case let items as [Any]:
            self = .array(items.map { JSONValue(foundation: $0, depth: depth + 1) })
        case let fields as [String: Any]:
            var result: [String: JSONValue] = [:]
            result.reserveCapacity(fields.count)
            for (key, item) in fields {
                result[key] = JSONValue(foundation: item, depth: depth + 1)
            }
            self = .object(result)
        default:
            self = .null
        }
    }

    private static func nestingWithinLimit(_ data: Data) -> Bool {
        data.withUnsafeBytes { raw -> Bool in
            var depth = 0
            var inString = false
            var escaped = false
            for byte in raw {
                if inString {
                    if escaped {
                        escaped = false
                    } else if byte == 0x5C {
                        escaped = true
                    } else if byte == 0x22 {
                        inString = false
                    }
                    continue
                }
                switch byte {
                case 0x22:
                    inString = true
                case 0x5B, 0x7B:
                    depth += 1
                    if depth > maxNesting { return false }
                case 0x5D, 0x7D:
                    depth -= 1
                default:
                    break
                }
            }
            return true
        }
    }
}

extension JSONValue {
    static func format(_ value: Double) -> String {
        guard value.isFinite else { return "null" }
        if value.rounded() == value, abs(value) < 1e15 {
            return String(Int64(value))
        }
        return "\(value)"
    }

    static func message(_ fields: [(String, JSONValue)]) -> String {
        var out = ""
        writeObject(fields, into: &out)
        return out
    }

    private func write(into out: inout String) {
        switch self {
        case .null:
            out += "null"
        case .bool(let value):
            out += value ? "true" : "false"
        case .number(let value):
            out += JSONValue.format(value)
        case .string(let value):
            JSONValue.quote(value, into: &out)
        case .array(let items):
            out += "["
            for (index, item) in items.enumerated() {
                if index > 0 { out += "," }
                item.write(into: &out)
            }
            out += "]"
        case .object(let fields):
            let ordered = fields.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
            JSONValue.writeObject(ordered, into: &out)
        }
    }

    private static func writeObject(_ fields: [(String, JSONValue)], into out: inout String) {
        out += "{"
        for (index, field) in fields.enumerated() {
            if index > 0 { out += "," }
            quote(field.0, into: &out)
            out += ":"
            field.1.write(into: &out)
        }
        out += "}"
    }

    private static func quote(_ value: String, into out: inout String) {
        out += "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"":
                out += "\\\""
            case "\\":
                out += "\\\\"
            case "\n":
                out += "\\n"
            case "\r":
                out += "\\r"
            case "\t":
                out += "\\t"
            default:
                if scalar.value < 0x20 {
                    let hex = String(scalar.value, radix: 16)
                    out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
    }
}
