import Charts
import SwiftUI

enum PathBuilder {
    static func make(_ value: JSONValue?) -> Path {
        var path = Path()
        for item in (value?.array ?? []).prefix(20000) {
            guard let parts = item.array, let op = parts.first?.string else { continue }
            let n = parts.dropFirst().map { CGFloat(min(max($0.number ?? 0, -1_000_000), 1_000_000)) }
            switch op {
            case "M" where n.count >= 2:
                path.move(to: CGPoint(x: n[0], y: n[1]))
            case "L" where n.count >= 2:
                path.addLine(to: CGPoint(x: n[0], y: n[1]))
            case "Q" where n.count >= 4:
                path.addQuadCurve(to: CGPoint(x: n[2], y: n[3]), control: CGPoint(x: n[0], y: n[1]))
            case "C" where n.count >= 6:
                path.addCurve(to: CGPoint(x: n[4], y: n[5]), control1: CGPoint(x: n[0], y: n[1]), control2: CGPoint(x: n[2], y: n[3]))
            case "Z":
                path.closeSubpath()
            default:
                break
            }
        }
        return path
    }

    static func box(_ value: JSONValue?) -> CGSize? {
        guard let parts = value?.array, parts.count == 2, let width = parts[0].number, let height = parts[1].number, width > 0, height > 0 else { return nil }
        return CGSize(width: width, height: height)
    }
}

struct ScaledPath: Shape {
    let path: Path
    let box: CGSize?

    func path(in rect: CGRect) -> Path {
        guard let box else { return path }
        return path.applying(CGAffineTransform(scaleX: rect.width / box.width, y: rect.height / box.height))
    }
}

@MainActor
enum Paint {
    static func cap(_ name: String?) -> CGLineCap {
        switch name {
        case "round": return .round
        case "square": return .square
        default: return .butt
        }
    }

    static func dash(_ value: JSONValue?) -> [CGFloat] {
        (value?.array ?? []).prefix(16).compactMap { $0.number }.map { CGFloat(min(max($0, 0), 10000)) }
    }

    static func stroke(_ mod: Mod) -> StrokeStyle {
        StrokeStyle(lineWidth: max(mod.value("width", default: 1), 0), lineCap: cap(mod.string("cap")), lineJoin: .round, dash: dash(mod.fields["dash"]))
    }

    static func shape<S: Shape>(_ node: ViewNode, _ base: S) -> AnyShape {
        guard let trim = node.mod("trim") else { return AnyShape(base) }
        let from = min(max(trim.number("from") ?? 0, 0), 1)
        let to = min(max(trim.number("to") ?? 1, from), 1)
        return AnyShape(base.trim(from: from, to: to))
    }

    @ViewBuilder
    static func view<S: Shape>(_ node: ViewNode, _ base: S) -> some View {
        let shape = Self.shape(node, base)
        let fill = node.mod("fill").flatMap { Palette.style($0.fields["color"]) }
        if let stroke = node.mod("stroke") {
            let style = Palette.style(stroke.fields["color"]) ?? AnyShapeStyle(.foreground)
            if let fill {
                shape.fill(fill).overlay {
                    shape.stroke(style, style: Self.stroke(stroke))
                }
            } else {
                shape.stroke(style, style: Self.stroke(stroke))
            }
        } else {
            shape.fill(fill ?? AnyShapeStyle(.foreground))
        }
    }
}

struct PathNode: View {
    let node: ViewNode

    var body: some View {
        Paint.view(node, ScaledPath(path: PathBuilder.make(node.props["cmds"]), box: PathBuilder.box(node.props["box"])))
    }
}

struct CanvasNode: View {
    let node: ViewNode

    private struct Op {
        let kind: String
        let path: Path
        let color: Color
        let style: StrokeStyle
        let opacity: Double
        let text: String
        let point: CGPoint
        let size: CGFloat
    }

    var body: some View {
        let box = PathBuilder.box(node.props["box"])
        let ops: [Op] = (node.props["ops"]?.array ?? []).prefix(5000).compactMap { item in
            guard let fields = item.object, let kind = fields["op"]?.string else { return nil }
            let style = StrokeStyle(
                lineWidth: CGFloat(min(max(fields["width"]?.number ?? 1, 0), 1000)),
                lineCap: Paint.cap(fields["cap"]?.string),
                lineJoin: .round,
                dash: Paint.dash(fields["dash"])
            )
            return Op(
                kind: kind,
                path: PathBuilder.make(fields["cmds"]),
                color: Palette.color(fields["color"]) ?? .primary,
                style: style,
                opacity: min(max(fields["opacity"]?.number ?? 1, 0), 1),
                text: fields["text"]?.text ?? "",
                point: CGPoint(x: fields["x"]?.number ?? 0, y: fields["y"]?.number ?? 0),
                size: CGFloat(min(max(fields["size"]?.number ?? 17, 1), 400))
            )
        }
        Canvas { context, size in
            let sx = box.map { size.width / $0.width } ?? 1
            let sy = box.map { size.height / $0.height } ?? 1
            let scale = CGAffineTransform(scaleX: sx, y: sy)
            for op in ops {
                var layer = context
                layer.opacity = op.opacity
                switch op.kind {
                case "fill":
                    layer.fill(op.path.applying(scale), with: .color(op.color))
                case "stroke":
                    layer.stroke(op.path.applying(scale), with: .color(op.color), style: op.style)
                case "text":
                    layer.draw(Text(verbatim: op.text).font(.system(size: op.size)).foregroundColor(op.color), at: CGPoint(x: op.point.x * sx, y: op.point.y * sy))
                default:
                    break
                }
            }
        }
    }
}

struct GaugeNode: View {
    let node: ViewNode

    var body: some View {
        let low = node.number("min") ?? 0
        let top = node.number("max") ?? 1
        let high = top > low ? top : low + 1
        let value = min(max(node.number("value") ?? 0, low), high)
        let gauge = Gauge(value: value, in: low...high) {
            Text(verbatim: node.string("title") ?? "")
        } currentValueLabel: {
            Text(verbatim: node.string("current") ?? "")
        } minimumValueLabel: {
            Text(verbatim: node.string("low") ?? "")
        } maximumValueLabel: {
            Text(verbatim: node.string("high") ?? "")
        }
        switch node.string("style") {
        case "accessoryCircular":
            gauge.gaugeStyle(.accessoryCircular)
        case "accessoryCircularCapacity":
            gauge.gaugeStyle(.accessoryCircularCapacity)
        case "accessoryLinear":
            gauge.gaugeStyle(.accessoryLinear)
        case "accessoryLinearCapacity":
            gauge.gaugeStyle(.accessoryLinearCapacity)
        case "linearCapacity":
            gauge.gaugeStyle(.linearCapacity)
        default:
            gauge
        }
    }
}

struct MarkData: Identifiable {
    enum Value {
        case text(String)
        case number(Double)
        case date(Date)
    }

    let id: Int
    let kind: String
    let x: Value?
    let y: Value?
    let xLabel: String
    let yLabel: String
    let angle: Double
    let inner: Double
    let series: String?
    let color: Color?
    let opacity: Double
    let smooth: Bool

    init(index: Int, node: ViewNode) {
        id = index
        kind = node.string("mark") ?? "bar"
        let px = MarkData.plot(node.props["x"])
        let py = MarkData.plot(node.props["y"])
        let pa = MarkData.plot(node.props["angle"])
        x = px?.1
        y = py?.1
        xLabel = px?.0 ?? pa?.0 ?? "x"
        yLabel = py?.0 ?? "y"
        if case let .number(value)? = pa?.1 {
            angle = max(value, 0)
        } else {
            angle = 0
        }
        let radius = node.number("innerRadius") ?? 0
        inner = radius < 0 ? min(-radius, 0.95) : 0
        series = node.string("series")
        color = node.mod("foreground").flatMap { Palette.color($0.fields["color"]) }
        opacity = min(max(node.mod("opacity")?.number("value") ?? 1, 0), 1)
        smooth = node.bool("smooth") ?? false
    }

    private static func plot(_ value: JSONValue?) -> (String, Value)? {
        guard let fields = value?.object, let kind = fields["kind"]?.string else { return nil }
        let label = fields["label"]?.string ?? ""
        switch kind {
        case "n":
            return (label, .number(fields["v"]?.number ?? 0))
        case "d":
            return (label, .date(Date(timeIntervalSince1970: (fields["v"]?.number ?? 0) / 1000)))
        default:
            return (label, .text(fields["v"]?.text ?? ""))
        }
    }
}

enum ChartMarks {
    @ChartContentBuilder
    static func content(_ m: MarkData) -> some ChartContent {
        if m.kind == "sector" {
            styled(SectorMark(angle: .value(m.xLabel, m.angle), innerRadius: .ratio(m.inner), angularInset: 1), m)
        } else if m.kind == "rule" {
            rule(m)
        } else {
            plotted(m)
        }
    }

    @ChartContentBuilder
    private static func plotted(_ m: MarkData) -> some ChartContent {
        if case let .text(x)? = m.x, case let .number(y)? = m.y {
            styled(shape(m.kind, x: .value(m.xLabel, x), y: .value(m.yLabel, y)), m)
        } else if case let .number(x)? = m.x, case let .number(y)? = m.y {
            styled(shape(m.kind, x: .value(m.xLabel, x), y: .value(m.yLabel, y)), m)
        } else if case let .date(x)? = m.x, case let .number(y)? = m.y {
            styled(shape(m.kind, x: .value(m.xLabel, x), y: .value(m.yLabel, y)), m)
        } else if case let .number(x)? = m.x, case let .text(y)? = m.y {
            styled(shape(m.kind, x: .value(m.xLabel, x), y: .value(m.yLabel, y)), m)
        }
    }

    @ChartContentBuilder
    private static func rule(_ m: MarkData) -> some ChartContent {
        if case let .number(y)? = m.y {
            styled(RuleMark(y: .value(m.yLabel, y)), m)
        } else if case let .number(x)? = m.x {
            styled(RuleMark(x: .value(m.xLabel, x)), m)
        } else if case let .text(x)? = m.x {
            styled(RuleMark(x: .value(m.xLabel, x)), m)
        } else if case let .date(x)? = m.x {
            styled(RuleMark(x: .value(m.xLabel, x)), m)
        }
    }

    @ChartContentBuilder
    private static func shape<X: Plottable, Y: Plottable>(_ kind: String, x: PlottableValue<X>, y: PlottableValue<Y>) -> some ChartContent {
        if kind == "line" {
            LineMark(x: x, y: y)
        } else if kind == "area" {
            AreaMark(x: x, y: y)
        } else if kind == "point" {
            PointMark(x: x, y: y)
        } else {
            BarMark(x: x, y: y)
        }
    }

    @ChartContentBuilder
    private static func styled<C: ChartContent>(_ content: C, _ m: MarkData) -> some ChartContent {
        if let series = m.series {
            content.opacity(m.opacity).interpolationMethod(m.smooth ? .catmullRom : .linear).foregroundStyle(by: .value("Series", series))
        } else if let color = m.color {
            content.opacity(m.opacity).interpolationMethod(m.smooth ? .catmullRom : .linear).foregroundStyle(color)
        } else {
            content.opacity(m.opacity).interpolationMethod(m.smooth ? .catmullRom : .linear)
        }
    }
}

struct ChartNode: View {
    let node: ViewNode

    var body: some View {
        let marks = node.children.prefix(2000).enumerated().map { MarkData(index: $0.offset, node: $0.element) }
        configured(
            AnyView(
                Chart(marks) { mark in
                    ChartMarks.content(mark)
                }
            )
        )
    }

    private func configured(_ base: AnyView) -> AnyView {
        var view = base
        if node.props["xAxis"]?.bool == false {
            view = AnyView(view.chartXAxis(.hidden))
        }
        if node.props["yAxis"]?.bool == false {
            view = AnyView(view.chartYAxis(.hidden))
        }
        if node.props["legend"]?.bool == false {
            view = AnyView(view.chartLegend(.hidden))
        }
        if let domain = node.props["yDomain"]?.array, domain.count == 2, let low = domain[0].number, let high = domain[1].number, high > low {
            view = AnyView(view.chartYScale(domain: low...high))
        }
        return view
    }
}

struct SplitNode: View {
    let node: ViewNode
    let depth: Int

    var body: some View {
        HStack(spacing: 0) {
            ForEach(node.children) { column in
                if column.string("column") == "detail" {
                    NodeView(node: column, depth: depth + 1)
                        .frame(maxWidth: .infinity)
                } else {
                    NodeView(node: column, depth: depth + 1)
                        .frame(width: 320)
                    Divider()
                }
            }
        }
    }
}

@MainActor
enum Glass26 {
    static func effect(_ mod: Mod, _ view: AnyView) -> AnyView {
        let shape = ShapeKind.make(mod.fields["shape"]) ?? AnyShape(Capsule())
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            var glass: Glass = mod.fields["clear"]?.bool == true ? .clear : .regular
            if let tint = Palette.color(mod.fields["tint"]) {
                glass = glass.tint(tint)
            }
            if mod.fields["interactive"]?.bool == true {
                glass = glass.interactive()
            }
            return AnyView(view.glassEffect(glass, in: shape))
        }
        #endif
        return AnyView(
            view
                .background(.ultraThinMaterial, in: shape)
                .overlay {
                    shape.stroke(Color.white.opacity(0.18), lineWidth: 0.5)
                }
        )
    }

    static func accessory(_ nodes: [ViewNode], _ view: AnyView, depth: Int) -> AnyView {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            return AnyView(
                view.tabViewBottomAccessory {
                    NodeList(nodes: nodes, depth: depth + 1)
                }
            )
        }
        #endif
        return AnyView(
            view.safeAreaInset(edge: .bottom) {
                HStack {
                    NodeList(nodes: nodes, depth: depth + 1)
                }
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(.ultraThinMaterial, in: Capsule())
                .padding(.horizontal, 20)
            }
        )
    }

    static func button(_ prominent: Bool, _ view: AnyView) -> AnyView {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            return prominent ? AnyView(view.buttonStyle(.glassProminent)) : AnyView(view.buttonStyle(.glass))
        }
        #endif
        return prominent ? AnyView(view.buttonStyle(.borderedProminent)) : AnyView(view.buttonStyle(.bordered))
    }
}
