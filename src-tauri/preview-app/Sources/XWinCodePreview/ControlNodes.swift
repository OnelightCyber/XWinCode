import SwiftUI

struct Echo<Value: Equatable> {
    var shown: Value
    var remote: Value
    var pending: [Value] = []
    var stamp = 0

    init(_ value: Value) {
        shown = value
        remote = value
    }

    mutating func edit(_ value: Value) -> Bool {
        guard value != shown else { return false }
        shown = value
        pending.append(value)
        if pending.count > 64 {
            pending.removeFirst(pending.count - 64)
        }
        stamp &+= 1
        return true
    }

    mutating func receive(_ value: Value) {
        remote = value
        if let index = pending.firstIndex(of: value) {
            pending.removeFirst(index + 1)
        } else {
            pending.removeAll()
            shown = value
        }
    }

    mutating func settle() {
        guard !pending.isEmpty else { return }
        pending.removeAll()
        shown = remote
    }
}

struct EchoSync<Value: Equatable>: ViewModifier {
    @Binding var echo: Echo<Value>
    let incoming: Value

    func body(content: Content) -> some View {
        content
            .onChange(of: incoming) { _, value in
                echo.receive(value)
            }
            .task(id: echo.stamp) {
                guard !echo.pending.isEmpty else { return }
                try? await Task.sleep(for: .seconds(2))
                guard !Task.isCancelled else { return }
                echo.settle()
            }
    }
}

struct ButtonNode: View {
    let node: ViewNode
    let depth: Int
    @Environment(\.previewEvents) private var events

    var body: some View {
        Button(role: role) {
            if let id = node.event {
                events.send(id, "tap", .null)
            }
        } label: {
            if node.label.isEmpty {
                RichText.make(node.string("title") ?? "")
            } else {
                NodeList(nodes: node.label, depth: depth + 1)
            }
        }
    }

    private var role: ButtonRole? {
        switch node.string("role") {
        case "destructive": return .destructive
        case "cancel": return .cancel
        default: return nil
        }
    }
}

struct NavigationLinkNode: View {
    let node: ViewNode
    let depth: Int

    var body: some View {
        NavigationLink {
            NodeList(nodes: node.children, depth: depth + 1)
        } label: {
            if node.label.isEmpty {
                RichText.make(node.string("title") ?? "")
            } else {
                NodeList(nodes: node.label, depth: depth + 1)
            }
        }
    }
}

struct ToggleNode: View {
    let node: ViewNode
    let depth: Int
    @Environment(\.previewEvents) private var events
    @State private var echo: Echo<Bool>

    init(node: ViewNode, depth: Int) {
        self.node = node
        self.depth = depth
        _echo = State(initialValue: Echo(node.bool("isOn") ?? false))
    }

    var body: some View {
        Toggle(isOn: Binding(get: { echo.shown }, set: { update($0) })) {
            if node.label.isEmpty {
                RichText.make(node.string("title") ?? "")
            } else {
                NodeList(nodes: node.label, depth: depth + 1)
            }
        }
        .modifier(EchoSync(echo: $echo, incoming: node.bool("isOn") ?? false))
    }

    private func update(_ value: Bool) {
        if echo.edit(value), let id = node.event {
            events.send(id, "set", .bool(value))
        }
    }
}

struct SliderNode: View {
    let node: ViewNode
    @Environment(\.previewEvents) private var events
    @State private var echo: Echo<Double>

    init(node: ViewNode) {
        self.node = node
        _echo = State(initialValue: Echo(node.number("value") ?? 0))
    }

    var body: some View {
        let range = bounds
        let binding = Binding(
            get: { min(max(echo.shown, range.lowerBound), range.upperBound) },
            set: { update($0) }
        )
        Group {
            if let step = step(in: range) {
                Slider(value: binding, in: range, step: step)
            } else {
                Slider(value: binding, in: range)
            }
        }
        .modifier(EchoSync(echo: $echo, incoming: node.number("value") ?? 0))
    }

    private var bounds: ClosedRange<Double> {
        let lower = min(max(node.number("min") ?? 0, -1e12), 1e12)
        var upper = min(max(node.number("max") ?? 1, -1e12), 1e12)
        if upper <= lower {
            upper = lower + 1
        }
        return lower...upper
    }

    private func step(in range: ClosedRange<Double>) -> Double? {
        guard let step = node.number("step"), step > 0 else { return nil }
        guard (range.upperBound - range.lowerBound) / step <= 100_000 else { return nil }
        return step
    }

    private func update(_ value: Double) {
        if echo.edit(value), let id = node.event {
            events.send(id, "set", .number(value))
        }
    }
}

struct StepperNode: View {
    let node: ViewNode
    let depth: Int
    @Environment(\.previewEvents) private var events

    var body: some View {
        let value = node.number("value")
        let atUpper = value.flatMap { current in node.number("max").map { current >= $0 } } ?? false
        let atLower = value.flatMap { current in node.number("min").map { current <= $0 } } ?? false
        let increment: (() -> Void)? = atUpper ? nil : { send("increment") }
        let decrement: (() -> Void)? = atLower ? nil : { send("decrement") }
        Stepper(label: { title(value) }, onIncrement: increment, onDecrement: decrement)
    }

    @ViewBuilder
    private func title(_ value: Double?) -> some View {
        if !node.label.isEmpty {
            NodeList(nodes: node.label, depth: depth + 1)
        } else if let title = node.string("title") {
            RichText.make(title)
        } else {
            Text(verbatim: value.map(JSONValue.format) ?? "")
        }
    }

    private func send(_ kind: String) {
        if let id = node.event {
            events.send(id, kind, .null)
        }
    }
}

struct TextInputNode: View {
    let node: ViewNode
    let secure: Bool
    @Environment(\.previewEvents) private var events
    @State private var echo: Echo<String>

    init(node: ViewNode, secure: Bool) {
        self.node = node
        self.secure = secure
        _echo = State(initialValue: Echo(node.string("text") ?? ""))
    }

    var body: some View {
        let binding = Binding(get: { echo.shown }, set: { update($0) })
        let placeholder = node.string("placeholder") ?? ""
        Group {
            if secure {
                SecureField(placeholder, text: binding)
            } else {
                TextField(placeholder, text: binding)
            }
        }
        .modifier(EchoSync(echo: $echo, incoming: node.string("text") ?? ""))
    }

    private func update(_ value: String) {
        if echo.edit(value), let id = node.event {
            events.send(id, "set", .string(value))
        }
    }
}

struct PickerNode: View {
    let node: ViewNode
    let depth: Int
    @Environment(\.previewEvents) private var events
    @State private var echo: Echo<JSONValue>

    init(node: ViewNode, depth: Int) {
        self.node = node
        self.depth = depth
        _echo = State(initialValue: Echo(node.props["selection"] ?? .null))
    }

    var body: some View {
        let style = node.mod("pickerStyle")?.string("value")
        let rich = style == "wheel" || style == "inline"
        Picker(selection: Binding(get: { echo.shown }, set: { update($0) })) {
            ForEach(node.options) { option in
                row(option, rich: rich)
                    .tag(option.tag)
            }
        } label: {
            RichText.make(node.string("title") ?? "")
        }
        .modifier(EchoSync(echo: $echo, incoming: node.props["selection"] ?? .null))
    }

    @ViewBuilder
    private func row(_ option: PickerOption, rich: Bool) -> some View {
        if rich, !option.label.isEmpty {
            HStack {
                NodeList(nodes: option.label, depth: depth + 1)
            }
        } else {
            Primitives.label(option.label, fallback: option.tag.text ?? "")
        }
    }

    private func update(_ value: JSONValue) {
        if echo.edit(value), let id = node.event {
            events.send(id, "set", value)
        }
    }
}

struct ProgressNode: View {
    let node: ViewNode

    var body: some View {
        let title = node.string("title")
        if let value = node.number("value") {
            let total = node.number("total").flatMap { $0 > 0 ? $0 : nil } ?? 1
            let current = min(max(value, 0), total)
            if let title {
                ProgressView(title, value: current, total: total)
            } else {
                ProgressView(value: current, total: total)
            }
        } else if let title {
            ProgressView(title)
        } else {
            ProgressView()
        }
    }
}

struct LinkNode: View {
    let node: ViewNode

    var body: some View {
        let title = RichText.make(node.string("title") ?? node.string("url") ?? "")
        if let raw = node.string("url"), let url = URL(string: raw), url.scheme != nil {
            Link(destination: url) {
                title
            }
        } else {
            title.foregroundStyle(.tint)
        }
    }
}
