import SwiftUI

struct PreviewEvents {
    var send: (String, String, JSONValue) -> Void
}

private struct PreviewEventsKey: EnvironmentKey {
    static let defaultValue = PreviewEvents { _, _, _ in }
}

extension EnvironmentValues {
    var previewEvents: PreviewEvents {
        get { self[PreviewEventsKey.self] }
        set { self[PreviewEventsKey.self] = newValue }
    }
}

struct NodeList: View {
    let nodes: [ViewNode]
    let depth: Int

    var body: some View {
        ForEach(nodes) { node in
            NodeView(node: node, depth: depth)
        }
    }
}

struct NodeView: View {
    let node: ViewNode
    let depth: Int
    @Environment(\.previewEvents) private var events

    var body: some View {
        if depth > ViewNode.maxDepth {
            UnsupportedBox(name: "Too deep")
        } else {
            Modifiers.apply(node, to: AnyView(BaseView(node: node, depth: depth)), depth: depth, events: events)
        }
    }
}

struct BaseView: View {
    let node: ViewNode
    let depth: Int

    private var children: NodeList {
        NodeList(nodes: node.children, depth: depth + 1)
    }

    var body: some View {
        switch node.type {
        case "Text":
            RichText.make(node.string("text") ?? "")
        case "Image":
            ImageNode(node: node)
        case "Label":
            LabelNode(node: node, depth: depth)
        case "Button":
            ButtonNode(node: node, depth: depth)
        case "NavigationLink":
            NavigationLinkNode(node: node, depth: depth)
        case "Toggle":
            ToggleNode(node: node, depth: depth)
        case "Slider":
            SliderNode(node: node)
        case "Stepper":
            StepperNode(node: node, depth: depth)
        case "TextField":
            TextInputNode(node: node, secure: false)
        case "SecureField":
            TextInputNode(node: node, secure: true)
        case "Picker":
            PickerNode(node: node, depth: depth)
        case "ProgressView":
            ProgressNode(node: node)
        case "Link":
            LinkNode(node: node)
        case "Spacer":
            Spacer(minLength: node.length("minLength"))
        case "Divider":
            Divider()
        case "EmptyView":
            EmptyView()
        case "Color":
            Palette.color(node.props["color"]) ?? Color.clear
        case "Rectangle", "RoundedRectangle", "Circle", "Capsule", "Ellipse":
            ShapeNode(node: node)
        case "VStack":
            VStack(alignment: Layout.horizontal(node.string("alignment")), spacing: node.offset("spacing")) {
                children
            }
        case "LazyVStack":
            LazyVStack(alignment: Layout.horizontal(node.string("alignment")), spacing: node.offset("spacing")) {
                children
            }
        case "HStack":
            HStack(alignment: Layout.vertical(node.string("alignment")), spacing: node.offset("spacing")) {
                children
            }
        case "LazyHStack":
            LazyHStack(alignment: Layout.vertical(node.string("alignment")), spacing: node.offset("spacing")) {
                children
            }
        case "ZStack":
            ZStack(alignment: Layout.alignment(node.string("alignment"))) {
                children
            }
        case "LazyVGrid":
            GridNode(node: node, depth: depth)
        case "ScrollView":
            ScrollView(node.string("axis") == "horizontal" ? .horizontal : .vertical) {
                children
            }
        case "List":
            List {
                children
            }
        case "Form":
            Form {
                children
            }
        case "Section":
            SectionNode(node: node, depth: depth)
        case "NavigationStack":
            NavigationStack {
                children
            }
        case "TabView":
            TabNode(node: node, depth: depth)
        case "Group":
            Group {
                children
            }
        case "Unsupported":
            UnsupportedBox(name: node.string("name") ?? "View")
        default:
            UnsupportedBox(name: node.type)
        }
    }
}

struct GridNode: View {
    let node: ViewNode
    let depth: Int

    var body: some View {
        let count = Int(min(max(node.number("columns") ?? 2, 1), 12))
        let spacing = node.offset("spacing")
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: spacing), count: count), spacing: spacing) {
            NodeList(nodes: node.children, depth: depth + 1)
        }
    }
}

struct SectionNode: View {
    let node: ViewNode
    let depth: Int

    var body: some View {
        Section {
            NodeList(nodes: node.children, depth: depth + 1)
        } header: {
            if !node.label.isEmpty {
                NodeList(nodes: node.label, depth: depth + 1)
            } else if let header = node.string("header") {
                RichText.make(header)
            }
        } footer: {
            if let footer = node.string("footer") {
                RichText.make(footer)
            }
        }
    }
}

struct TabNode: View {
    let node: ViewNode
    let depth: Int

    var body: some View {
        TabView {
            ForEach(node.children) { child in
                NodeView(node: child, depth: depth + 1)
                    .tabItem {
                        Primitives.label(child.mod("tabItem")?.nodes ?? [])
                    }
            }
        }
    }
}
