import SwiftUI

@MainActor
enum Modifiers {
    static func apply(_ node: ViewNode, to base: AnyView, depth: Int, events: PreviewEvents) -> AnyView {
        var view = base
        for mod in node.mods {
            view = apply(mod, to: view, depth: depth, events: events)
        }
        return AnyView(view.disabled(node.has("disabled")))
    }

    private static func apply(_ mod: Mod, to view: AnyView, depth: Int, events: PreviewEvents) -> AnyView {
        switch mod.kind {
        case "padding":
            let insets = EdgeInsets(
                top: mod.value("top"),
                leading: mod.value("leading"),
                bottom: mod.value("bottom"),
                trailing: mod.value("trailing")
            )
            return AnyView(view.padding(insets))
        case "frame":
            return frame(mod, view)
        case "font":
            guard let font = Typography.font(mod.fields["font"]) else { return view }
            return AnyView(view.font(font))
        case "bold":
            return AnyView(view.bold())
        case "italic":
            return AnyView(view.italic())
        case "fontWeight":
            guard let weight = Typography.weight(mod.string("weight")) else { return view }
            return AnyView(view.fontWeight(weight))
        case "fontDesign":
            guard let design = Typography.design(mod.string("design")) else { return view }
            return AnyView(view.fontDesign(design))
        case "monospaced":
            return AnyView(view.monospaced())
        case "underline":
            return AnyView(view.underline())
        case "strikethrough":
            return AnyView(view.strikethrough())
        case "textCase":
            return AnyView(view.textCase(mod.string("value") == "lowercase" ? .lowercase : .uppercase))
        case "lineSpacing":
            return AnyView(view.lineSpacing(mod.value("value")))
        case "foreground":
            guard let style = Palette.style(mod.fields["color"]) else { return view }
            return AnyView(view.foregroundStyle(style))
        case "tint":
            guard let color = Palette.color(mod.fields["color"]) else { return view }
            return AnyView(view.tint(color))
        case "background":
            return background(mod, view, depth: depth)
        case "overlay":
            let alignment = Layout.alignment(mod.string("alignment"))
            return AnyView(view.overlay(alignment: alignment) {
                NodeList(nodes: mod.nodes, depth: depth + 1)
            })
        case "clip":
            guard let shape = ShapeKind.make(mod.fields["shape"]) else { return view }
            return AnyView(view.clipShape(shape))
        case "cornerRadius":
            let radius = max(mod.value("radius"), 0)
            return AnyView(view.clipShape(RoundedRectangle(cornerRadius: radius, style: .circular)))
        case "border":
            let style = Palette.style(mod.fields["color"]) ?? AnyShapeStyle(Color.primary)
            return AnyView(view.border(style, width: max(mod.value("width", default: 1), 0)))
        case "shadow":
            let color = Palette.color(mod.fields["color"]) ?? Color.black.opacity(0.33)
            let radius = min(max(mod.value("radius"), 0), 1000)
            return AnyView(view.shadow(color: color, radius: radius, x: mod.value("x"), y: mod.value("y")))
        case "opacity":
            return AnyView(view.opacity(min(max(mod.number("value") ?? 1, 0), 1)))
        case "animation":
            return AnyView(view.animation(Motion.animation(mod.fields["curve"]), value: mod.string("value") ?? ""))
        case "transition":
            return AnyView(view.transition(Motion.transition(mod.string("kind"), edge: mod.string("edge"))))
        case "offset":
            return AnyView(view.offset(x: mod.value("x"), y: mod.value("y")))
        case "rotation":
            return AnyView(view.rotationEffect(.degrees(mod.number("degrees") ?? 0)))
        case "scale":
            return AnyView(view.scaleEffect(mod.value("value", default: 1)))
        case "align":
            return AnyView(view.multilineTextAlignment(Layout.text(mod.string("value"))))
        case "lineLimit":
            let limit = mod.number("value").map { Int(min(max($0, 0), 10_000)) }
            return AnyView(view.lineLimit(limit.flatMap { $0 > 0 ? $0 : nil }))
        case "buttonStyle":
            return buttonStyle(mod.string("value"), view)
        case "controlSize":
            return AnyView(view.controlSize(controlSize(mod.string("value"))))
        case "navTitle":
            return AnyView(
                view
                    .navigationTitle(mod.string("title") ?? "")
                    .navigationBarTitleDisplayMode(titleMode(mod.string("mode")))
            )
        case "ignoresSafeArea":
            return AnyView(view.ignoresSafeArea())
        case "scheme":
            return AnyView(view.preferredColorScheme(scheme(mod.string("value"))))
        case "aspect":
            let ratio = mod.number("ratio").flatMap { $0 > 0 ? CGFloat(min($0, 100_000)) : nil }
            let mode: ContentMode = mod.string("mode") == "fill" ? .fill : .fit
            return AnyView(view.aspectRatio(ratio, contentMode: mode))
        case "imageScale":
            return AnyView(view.imageScale(imageScale(mod.string("value"))))
        case "hidden":
            return AnyView(view.hidden())
        case "listStyle":
            return listStyle(mod.string("value"), view)
        case "pickerStyle":
            return pickerStyle(mod.string("value"), view)
        case "textFieldStyle":
            return textFieldStyle(mod.string("value"), view)
        case "onTap":
            guard let id = mod.string("event"), !id.isEmpty else { return view }
            return AnyView(view.onTapGesture {
                events.send(id, "tap", .null)
            })
        default:
            return view
        }
    }

    private static func frame(_ mod: Mod, _ view: AnyView) -> AnyView {
        let alignment = Layout.alignment(mod.string("alignment"))
        let minWidth = mod.size("minWidth")
        let minHeight = mod.size("minHeight")
        var maxWidth = mod.limit("maxWidth")
        var maxHeight = mod.limit("maxHeight")
        if let low = minWidth, let high = maxWidth, high < low {
            maxWidth = low
        }
        if let low = minHeight, let high = maxHeight, high < low {
            maxHeight = low
        }
        let fixed = view.frame(width: mod.size("width"), height: mod.size("height"), alignment: alignment)
        return AnyView(
            fixed.frame(
                minWidth: minWidth,
                maxWidth: maxWidth,
                minHeight: minHeight,
                maxHeight: maxHeight,
                alignment: alignment
            )
        )
    }

    private static func background(_ mod: Mod, _ view: AnyView, depth: Int) -> AnyView {
        if !mod.nodes.isEmpty {
            return AnyView(view.background {
                NodeList(nodes: mod.nodes, depth: depth + 1)
            })
        }
        let shape = ShapeKind.make(mod.fields["shape"])
        if let material = Palette.material(mod.string("material")) {
            if let shape {
                return AnyView(view.background(material, in: shape))
            }
            return AnyView(view.background(material))
        }
        if let style = Palette.style(mod.fields["color"]) {
            if let shape {
                return AnyView(view.background(style, in: shape))
            }
            return AnyView(view.background(style))
        }
        if let shape {
            return AnyView(view.background(in: shape))
        }
        return view
    }

    private static func buttonStyle(_ name: String?, _ view: AnyView) -> AnyView {
        switch name {
        case "borderedProminent": return AnyView(view.buttonStyle(.borderedProminent))
        case "bordered": return AnyView(view.buttonStyle(.bordered))
        case "plain": return AnyView(view.buttonStyle(.plain))
        case "borderless": return AnyView(view.buttonStyle(.borderless))
        default: return AnyView(view.buttonStyle(.automatic))
        }
    }

    private static func listStyle(_ name: String?, _ view: AnyView) -> AnyView {
        switch name {
        case "insetGrouped": return AnyView(view.listStyle(.insetGrouped))
        case "plain": return AnyView(view.listStyle(.plain))
        case "grouped": return AnyView(view.listStyle(.grouped))
        case "inset": return AnyView(view.listStyle(.inset))
        case "sidebar": return AnyView(view.listStyle(.sidebar))
        default: return AnyView(view.listStyle(.automatic))
        }
    }

    private static func pickerStyle(_ name: String?, _ view: AnyView) -> AnyView {
        switch name {
        case "segmented": return AnyView(view.pickerStyle(.segmented))
        case "menu": return AnyView(view.pickerStyle(.menu))
        case "wheel": return AnyView(view.pickerStyle(.wheel))
        case "inline": return AnyView(view.pickerStyle(.inline))
        default: return AnyView(view.pickerStyle(.automatic))
        }
    }

    private static func textFieldStyle(_ name: String?, _ view: AnyView) -> AnyView {
        switch name {
        case "roundedBorder": return AnyView(view.textFieldStyle(.roundedBorder))
        case "plain": return AnyView(view.textFieldStyle(.plain))
        default: return AnyView(view.textFieldStyle(.automatic))
        }
    }

    private static func controlSize(_ name: String?) -> ControlSize {
        switch name {
        case "mini": return .mini
        case "small": return .small
        case "large": return .large
        case "extraLarge": return .extraLarge
        default: return .regular
        }
    }

    private static func titleMode(_ name: String?) -> NavigationBarItem.TitleDisplayMode {
        switch name {
        case "large": return .large
        case "inline": return .inline
        default: return .automatic
        }
    }

    private static func scheme(_ name: String?) -> ColorScheme? {
        switch name {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }

    private static func imageScale(_ name: String?) -> Image.Scale {
        switch name {
        case "small": return .small
        case "large": return .large
        default: return .medium
        }
    }
}
