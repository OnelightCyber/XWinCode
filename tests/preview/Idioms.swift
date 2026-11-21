import SwiftUI
import Charts
import Observation

struct T01_UnknownContainer: View {
    var body: some View {
        GlassEffectContainer(spacing: 8) {
            Text("inside-unknown")
        }
    }
}

struct T02_OperatorFunction: View {
    let values = [1, 2, 3]
    var body: some View {
        Text("sum \(values.reduce(0, +))")
    }
}

enum Zone: Int, CaseIterable, Identifiable {
    case rest, fat, cardio, peak
    var id: Int { rawValue }
    var title: String {
        switch self {
        case .rest: "Repos"
        case .fat: "Brûle"
        case .cardio: "Cardio"
        case .peak: "Max"
        }
    }
    var color: Color {
        switch self {
        case .rest: return .gray
        case .fat: return .green
        case .cardio: return .orange
        case .peak: return .red
        }
    }
}

struct T03_EnumRawValue: View {
    let zone = Zone.cardio
    var body: some View {
        VStack {
            Text("raw \(zone.rawValue)")
            Text(zone.title)
            Text("count \(Zone.allCases.count)")
            Text("from \(Zone(rawValue: 3)?.title ?? "nil")")
            ForEach(Zone.allCases) { z in
                Text(z.title).foregroundStyle(z.color)
            }
        }
    }
}

enum LoadState {
    case idle
    case loading(progress: Double)
    case loaded([String])
    case failed(String)
}

struct T04_AssociatedValues: View {
    let state = LoadState.loaded(["a", "b"])
    let other = LoadState.loading(progress: 0.5)
    var body: some View {
        VStack {
            switch state {
            case .idle:
                Text("idle")
            case .loading(let progress):
                Text("loading \(progress)")
            case .loaded(let items):
                Text("items \(items.count)")
                Text("first \(items[0])")
            case .failed(let message):
                Text(message)
            }
            if case .loading(let p) = other {
                Text("half \(p, specifier: "%.1f")")
            }
        }
    }
}

struct T05_OptionalMap: View {
    let missing: Int? = nil
    let bpm: Int? = 72
    let name: String? = "hello"
    var body: some View {
        VStack {
            Text(missing.map(String.init) ?? "--")
            Text(bpm.map(String.init) ?? "--")
            Text("len \(name?.count ?? 0)")
        }
    }
}

@Observable
final class Counter {
    var count = 3
    var items: [String] = ["x", "y"]
    var doubled: Int { count * 2 }
    func bump() { count += 1 }
}

struct T06_Observable: View {
    @State private var counter = Counter()
    var body: some View {
        VStack {
            Text("count \(counter.count)")
            Text("doubled \(counter.doubled)")
            Text("items \(counter.items.count)")
            Button("Bump") { counter.bump() }
        }
    }
}

final class LegacyModel: ObservableObject {
    @Published var title = "legacy"
    @Published var on = true
}

struct T07_ObservableObject: View {
    @StateObject private var model = LegacyModel()
    var body: some View {
        VStack {
            Text(model.title)
            if model.on { Text("on") }
            Toggle("Switch", isOn: $model.on)
        }
    }
}

struct Card<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading) {
            Text(title).font(.headline)
            content()
        }
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}

struct Panel<Content: View>: View {
    private let content: Content
    private let label: String
    init(_ label: String, @ViewBuilder content: () -> Content) {
        self.label = label
        self.content = content()
    }
    var body: some View {
        VStack {
            Text(label)
            content
        }
    }
}

struct T08_GenericContainers: View {
    var body: some View {
        VStack {
            Card(title: "card-title") {
                Text("card-body")
            }
            Panel("panel-label") {
                Text("panel-body")
            }
        }
    }
}

struct CardStyle: ViewModifier {
    var radius: CGFloat = 12
    func body(content: Content) -> some View {
        content
            .padding()
            .background(Color.gray.opacity(0.2))
            .clipShape(RoundedRectangle(cornerRadius: radius))
    }
}

extension View {
    func card(radius: CGFloat = 12) -> some View {
        modifier(CardStyle(radius: radius))
    }
    @ViewBuilder
    func hidden(_ flag: Bool) -> some View {
        if flag { self.hidden() } else { self }
    }
}

struct T09_ViewModifier: View {
    var body: some View {
        VStack {
            Text("modified-a").modifier(CardStyle())
            Text("modified-b").card(radius: 20)
            Text("modified-c").hidden(false)
        }
    }
}

struct PillButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .background(configuration.isPressed ? Color.gray : Color.blue)
            .clipShape(Capsule())
    }
}

struct T10_ButtonStyle: View {
    var body: some View {
        Button {
        } label: {
            Text("styled-label")
        }
        .buttonStyle(PillButtonStyle())
    }
}

struct T11_ViewBuilders: View {
    let flag = false
    let level = 2
    var body: some View {
        VStack {
            header
            branch
            row(for: level)
        }
    }
    private var header: some View {
        Text("header-ok")
    }
    @ViewBuilder private var branch: some View {
        if flag {
            Text("branch-a")
        } else {
            Text("branch-b")
        }
    }
    @ViewBuilder
    private func row(for level: Int) -> some View {
        switch level {
        case 1: Text("case-one")
        case 2: Text("case-two")
        default: EmptyView()
        }
    }
}

struct Todo: Identifiable, Hashable {
    let id = UUID()
    var title: String
    var done = false
    static let samples = [Todo(title: "milk"), Todo(title: "eggs", done: true), Todo(title: "tea")]
}

struct T12_ForEachForms: View {
    let todos = Todo.samples
    var body: some View {
        VStack {
            ForEach(todos) { todo in
                Text(todo.title)
            }
            ForEach(0..<3, id: \.self) { i in
                Text("n\(i)")
            }
            ForEach(Array(todos.enumerated()), id: \.offset) { index, todo in
                Text("\(index) \(todo.title)")
            }
            ForEach(todos.indices, id: \.self) { i in
                Text("idx \(i)")
            }
            ForEach(todos, id: \.id) { Text($0.title) }
        }
    }
}

struct T13_ListSections: View {
    var body: some View {
        List {
            Section("Section A") {
                Text("row-1")
                    .swipeActions(edge: .trailing) {
                        Button("Delete", role: .destructive) {}
                    }
                    .listRowBackground(Color.clear)
            } footer: {
                Text("footer-a")
            }
            Section {
                Text("row-2")
            } header: {
                Text("Section B")
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
    }
}

struct T14_Navigation: View {
    @State private var path = NavigationPath()
    @State private var query = ""
    @State private var showing = false
    var body: some View {
        NavigationStack(path: $path) {
            List(Todo.samples) { todo in
                NavigationLink(value: todo) {
                    Text("nav-row-\(todo.title)")
                }
            }
            .navigationTitle("Todos")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: Todo.self) { todo in
                Text(todo.title)
            }
            .searchable(text: $query, prompt: "Search")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("toolbar-ok") { showing = true }
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    Spacer()
                    Image(systemName: "plus")
                }
            }
            .sheet(isPresented: $showing) {
                Text("sheet")
                    .presentationDetents([.medium, .large])
            }
            .alert("Oops", isPresented: $showing) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("message")
            }
            .refreshable { await reload() }
        }
    }
    private func reload() async {}
}

struct T15_TabsNew: View {
    @State private var selection = 0
    var body: some View {
        TabView(selection: $selection) {
            Tab("Home", systemImage: "house", value: 0) {
                Text("tab-home")
            }
            Tab("Settings", systemImage: "gear", value: 1) {
                Text("tab-settings")
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
    }
}

struct T16_Formatting: View {
    let value = 3.14159
    let ratio = 0.12
    let seconds = 65
    let big = 1234
    var body: some View {
        VStack {
            Text("\(value, specifier: "%.1f")")
            Text(ratio, format: .percent)
            Text(String(format: "%02d:%02d", seconds / 60, seconds % 60))
            Text(big.formatted())
            Text(value.formatted(.number.precision(.fractionLength(2))))
            Text(Date.now, style: .time)
            Text(Date.now.formatted(date: .abbreviated, time: .shortened))
            Text("v\(Int(2.9))")
        }
    }
}

struct T17_Collections: View {
    let todos = Todo.samples
    var body: some View {
        let open = todos.filter { !$0.done }.map(\.title).sorted().joined(separator: ", ")
        let done = todos.first(where: { $0.done })?.title ?? "none"
        let has = todos.contains(where: \.done)
        let longest = todos.max(by: { $0.title < $1.title })?.title ?? ""
        let total = todos.reduce(into: 0) { acc, t in if !t.done { acc += 1 } }
        let groups = Dictionary(grouping: todos, by: \.done)
        let pairs = zip([1, 2], ["a", "b"]).map { "\($0)\($1)" }
        let steps = stride(from: 0, through: 10, by: 5).map(String.init).joined(separator: ",")
        VStack {
            Text(done)
            Text(open)
            Text("has \(has)")
            Text("max \(longest)")
            Text("total \(total)")
            Text("groups \(groups.count)")
            Text("z \(pairs[0])")
            Text("s \(steps)")
        }
    }
}

struct T18_SwitchExpressions: View {
    let score = 90
    var body: some View {
        let label = switch score {
        case 0..<50: "level-low"
        case 50..<80: "level-mid"
        default: "level-high"
        }
        let size = if score > 50 { "big" } else { "small" }
        VStack {
            Text(label)
            Text("label \(size)")
        }
    }
}

protocol Describable {
    var name: String { get }
}

extension Describable {
    var summary: String { "proto-\(name)" }
    func shout() -> String { name.uppercased() }
}

struct Pet: Describable {
    let name: String
    private(set) var age = 2
    static let shared = Pet(name: "rex")
    static func make(_ n: String) -> Pet { Pet(name: n) }
    mutating func birthday() { age += 1 }
    struct Tag { let label: String }
    var tag: Tag { Tag(label: "tag-\(name)") }
}

struct T19_ProtocolsAndStatics: View {
    var body: some View {
        var copy = Pet.shared
        copy.birthday()
        return VStack {
            Text(Pet.shared.summary)
            Text(Pet.shared.shout())
            Text(Pet.shared.tag.label)
            Text("made-\(Pet.make("bo").name)")
            Text("age \(copy.age)")
        }
    }
}

struct T20_Geometry: View {
    var body: some View {
        GeometryReader { geo in
            Text("geo-ok")
                .frame(width: geo.size.width * 0.5, height: geo.size.height / 4)
                .position(x: geo.size.width / 2, y: 40)
        }
    }
}

struct Wave: Shape {
    var amplitude: CGFloat = 10
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.midY - amplitude))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.midY), control: CGPoint(x: rect.midX, y: rect.maxY))
        return path
    }
}

struct T21_ShapesAndCanvas: View {
    var body: some View {
        VStack {
            Text("shapes-ok")
            Wave(amplitude: 20).stroke(.blue, lineWidth: 2).frame(height: 60)
            Path { p in
                p.move(to: .zero)
                p.addLine(to: CGPoint(x: 100, y: 50))
                p.addArc(center: CGPoint(x: 50, y: 50), radius: 20, startAngle: .degrees(0), endAngle: .degrees(180), clockwise: false)
            }
            .stroke(Color.red, style: StrokeStyle(lineWidth: 3, lineCap: .round))
            Canvas { context, size in
                context.fill(Path(ellipseIn: CGRect(origin: .zero, size: size)), with: .color(.green))
            }
            .frame(height: 40)
            Circle().trim(from: 0, to: 0.7).stroke(.orange, style: StrokeStyle(lineWidth: 8, lineCap: .round)).rotationEffect(.degrees(-90))
        }
    }
}

struct Sale: Identifiable {
    let id = UUID()
    let day: String
    let amount: Double
}

struct T22_Charts: View {
    let sales = [Sale(day: "Mon", amount: 12), Sale(day: "Tue", amount: 30), Sale(day: "Wed", amount: 21)]
    var body: some View {
        VStack {
            Text("chart-title")
            Chart(sales) { sale in
                BarMark(x: .value("Day", sale.day), y: .value("Amount", sale.amount))
                    .foregroundStyle(.blue)
            }
            .frame(height: 160)
            Chart {
                ForEach(sales) { sale in
                    LineMark(x: .value("Day", sale.day), y: .value("Amount", sale.amount))
                    PointMark(x: .value("Day", sale.day), y: .value("Amount", sale.amount))
                }
                RuleMark(y: .value("Avg", 20))
            }
            .chartYScale(domain: 0...40)
            .chartXAxis(.hidden)
            Gauge(value: 0.4) { Text("gauge") }
            ProgressView(value: 0.3)
        }
    }
}

struct T23_Grids: View {
    let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)
    var body: some View {
        VStack {
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(0..<6) { i in
                    Text("cell \(i)")
                }
            }
            Grid(horizontalSpacing: 4) {
                GridRow {
                    Text("g-a")
                    Text("g-b")
                }
                GridRow {
                    Text("g-c").gridCellColumns(2)
                    Text("g-d")
                }
            }
        }
    }
}

struct T24_Decorations: View {
    var body: some View {
        VStack {
            Text("decorated")
                .padding()
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    Text("badge").font(.caption2)
                }
                .clipShape(.rect(cornerRadius: 12))
                .shadow(color: .black.opacity(0.2), radius: 8, y: 4)
                .glassEffect(.regular, in: .capsule)
            Text("masked")
                .mask { Rectangle() }
                .contentShape(Rectangle())
                .compositingGroup()
                .blur(radius: 0)
                .saturation(1)
        }
        .safeAreaInset(edge: .bottom) {
            Text("inset-ok")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            LinearGradient(colors: [.blue, .purple], startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()
        }
    }
}

struct T25_Lifecycle: View {
    @State private var items: [String] = []
    @State private var tick = 0
    let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    var body: some View {
        VStack {
            Text("life-ok")
            Text("loaded \(items.count)")
        }
        .task { await load() }
        .onAppear { items = ["a", "b"] }
        .onChange(of: tick) { old, new in
            print(old, new)
        }
        .onReceive(timer) { _ in tick += 1 }
        .onDisappear {}
        .animation(.easeInOut, value: tick)
        .sensoryFeedback(.success, trigger: tick)
    }
    private func load() async {
        try? await Task.sleep(for: .seconds(1))
    }
}

extension Double {
    var clean: String { truncatingRemainder(dividingBy: 1) == 0 ? String(format: "%.0f", self) : String(self) }
}

extension Int {
    var isEven: Bool { self % 2 == 0 }
    func times(_ n: Int) -> Int { self * n }
}

extension String {
    var shout: String { uppercased() + "!" }
}

extension Color {
    static let brand = Color(red: 0.2, green: 0.4, blue: 0.9)
    init(hex: UInt) {
        self.init(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255)
    }
}

struct T26_Extensions: View {
    var body: some View {
        VStack {
            Text("clean \(4.0.clean)")
            Text("even \(4.isEven)")
            Text("times \(3.times(4))")
            Text("hey".shout)
            Text("colored").foregroundStyle(Color.brand).background(Color(hex: 0xff8800))
        }
    }
}

struct T27_TextForms: View {
    var body: some View {
        VStack {
            Text("a") + Text("b").bold()
            Text(verbatim: "verbatim-ok")
            Text("**bold** text")
            Text("multi\nline").lineLimit(2).multilineTextAlignment(.center).minimumScaleFactor(0.5)
            Text("kern").kerning(2).tracking(1).baselineOffset(2).monospacedDigit().fontWidth(.condensed)
        }
    }
}

struct T28_Images: View {
    var body: some View {
        VStack {
            Text("images-ok")
            Image(systemName: "heart.fill")
                .symbolRenderingMode(.hierarchical)
                .symbolEffect(.pulse)
                .font(.system(size: 40))
                .foregroundStyle(.red.gradient)
            Image("photo")
                .resizable()
                .scaledToFill()
                .frame(width: 80, height: 80)
                .clipShape(Circle())
            Image(systemName: "star").imageScale(.large).symbolVariant(.fill)
        }
    }
}

enum Flavor: String, CaseIterable, Identifiable {
    case vanilla, chocolate
    var id: Self { self }
    var title: String { rawValue.capitalized }
}

struct T29_Controls: View {
    @State private var name = ""
    @State private var on = true
    @State private var flavor = Flavor.vanilla
    @State private var value = 0.5
    @State private var quantity = 2
    @State private var date = Date()
    @AppStorage("flag") private var flag = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool
    var body: some View {
        Form {
            Text("controls-ok")
            TextField("Name", text: $name).textFieldStyle(.roundedBorder).focused($focused)
            Toggle(isOn: $on) { Text("Enabled") }
            Picker("Flavor", selection: $flavor) {
                ForEach(Flavor.allCases) { f in
                    Text(f.title).tag(f)
                }
            }
            .pickerStyle(.segmented)
            Slider(value: $value, in: 0...1, step: 0.1)
            Text("value \(value, specifier: "%.1f")")
            Stepper("qty \(quantity)", value: $quantity, in: 0...10)
            DatePicker("When", selection: $date, displayedComponents: .date)
            Button("Close", role: .cancel) { dismiss() }
                .disabled(name.isEmpty)
                .tint(scheme == .dark ? .white : .black)
        }
    }
}

struct T30_Generics: View {
    typealias Pair = (Int, Int)
    func clamp<T: Comparable>(_ v: T, _ lo: T, _ hi: T) -> T { min(max(v, lo), hi) }
    func add(_ p: Pair) -> Int { p.0 + p.1 }
    var body: some View {
        VStack {
            Text("clamp \(clamp(15, 0, 10))")
            Text("pair \(add((1, 2)))")
        }
    }
}

struct T31_Bindings: View {
    @State private var todos = Todo.samples
    @State private var flag = true
    var body: some View {
        VStack {
            ForEach($todos) { $todo in
                Toggle("bound-\(todo.title)", isOn: $todo.done)
            }
            Toggle("first", isOn: $todos[0].done)
            Toggle("manual \(flag ? "on" : "off")", isOn: Binding(get: { flag }, set: { flag = $0 }))
        }
    }
}

struct T32_Strings: View {
    let s = "hello"
    var body: some View {
        VStack {
            Text(s.uppercased())
            Text("pre \(s.prefix(3))")
            Text("n \(s.count)")
            Text("parts \("a,b,c".split(separator: ",").count)")
            Text("swap".replacingOccurrences(of: "swap", with: "swapped"))
            Text("trim \("  ok ".trimmingCharacters(in: .whitespaces))")
            Text("has \(s.contains("ell"))")
            Text(s.isEmpty ? "empty" : "full")
            Text(s.hasPrefix("he") ? "pfx" : "nopfx")
        }
    }
}

struct T33_Dates: View {
    let start = Date()
    var body: some View {
        let later = start.addingTimeInterval(3600)
        let hour = Calendar.current.component(.hour, from: later)
        let comps = Calendar.current.dateComponents([.day, .month], from: start)
        let elapsed = later.timeIntervalSince(start)
        VStack {
            Text("dates-ok")
            Text(hour >= 0 ? "hour-ok" : "hour-bad")
            Text("day \(comps.day ?? 0)")
            Text("el \(Int(elapsed))")
            Text(later, format: .dateTime.hour().minute())
            Text(Duration.seconds(90).formatted(.time(pattern: .minuteSecond)))
        }
    }
}

struct T34_UnknownLeaf: View {
    var body: some View {
        VStack {
            Text("before-lib")
            LottieView(name: "confetti")
                .frame(height: 100)
            KFImage(URL(string: "https://example.com/a.png"))
            Text("after-lib")
        }
    }
}

struct T35_Timeline: View {
    var body: some View {
        TimelineView(.animation) { context in
            Text("timeline-ok")
                .opacity(context.date.timeIntervalSinceReferenceDate > 0 ? 1 : 0.5)
        }
    }
}

struct Profile {
    var name: String
    var age: Int
    private var secret = 1
    init(name: String, age: Int = 30) {
        self.name = name
        self.age = age
    }
}

struct Avatar: View {
    @State private var scale: CGFloat
    let profile: Profile
    var onTap: (() -> Void)?
    init(profile: Profile, scale: CGFloat = 1, onTap: (() -> Void)? = nil) {
        self.profile = profile
        self._scale = State(initialValue: scale)
        self.onTap = onTap
    }
    var body: some View {
        Text("avatar-\(profile.name)-\(profile.age)-\(Int(scale))")
            .onTapGesture { onTap?() }
    }
}

struct T36_ExplicitInit: View {
    var body: some View {
        Avatar(profile: Profile(name: "zoe"), scale: 2) {
            print("tap")
        }
    }
}

final class Store {
    var history: [Int] = [] {
        didSet { total = history.reduce(0, +) }
    }
    private(set) var total = 0
    lazy var label: String = "lazy-\(history.count)"
    var counts: [String: Int] = [:]
    subscript(key: String) -> Int { counts[key, default: 0] }
    func record(_ v: Int) {
        history.append(v)
        counts["n", default: 0] += 1
    }
}

struct T37_ClassFeatures: View {
    var body: some View {
        let store = Store()
        store.record(2)
        store.record(3)
        return VStack {
            Text("total \(store.total)")
            Text(store.label)
            Text("n \(store["n"])")
            Text("none \(store["zzz"])")
        }
    }
}

struct T38_Styles: View {
    let on = true
    var body: some View {
        Text("styled-ok")
            .font(.system(size: 20, weight: .bold, design: .rounded))
            .foregroundStyle(on ? .green : .secondary)
            .foregroundStyle(.linearGradient(colors: [.red, .blue], startPoint: .top, endPoint: .bottom))
            .background(on ? AnyShapeStyle(.tint) : AnyShapeStyle(Color.gray))
            .tint(.pink)
            .padding(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel("x")
            .id("styled")
            .zIndex(1)
            .allowsHitTesting(false)
    }
}

struct T39_ControlFlow: View {
    func parse(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "early" }
        var n = 0
        for ch in s where ch != " " { n += 1 }
        var i = 0
        while i < 3 { i += 1 }
        repeat { i -= 1 } while i > 0
        defer { n = 0 }
        do {
            let v = try risky(n)
            return "guarded \(v)"
        } catch {
            return "caught"
        }
    }
    func risky(_ n: Int) throws -> Int { n }
    var body: some View {
        VStack {
            Text(parse("a b cd"))
            Text(parse(nil))
        }
    }
}

struct T40_Scroll: View {
    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(spacing: 12, pinnedViews: [.sectionHeaders]) {
                Section {
                    ForEach(0..<5) { i in
                        Text("scroll-\(i)")
                            .containerRelativeFrame(.horizontal)
                            .scrollTransition { content, phase in
                                content.opacity(phase.isIdentity ? 1 : 0.4)
                            }
                    }
                } header: {
                    Text("pinned")
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .contentMargins(16, for: .scrollContent)
        .scrollIndicators(.hidden)
    }
}

struct T41_SplitView: View {
    var body: some View {
        NavigationSplitView {
            Text("split-side")
        } detail: {
            Text("split-detail")
        }
    }
}

struct T42_Misc: View {
    @State private var open = true
    var body: some View {
        VStack {
            Menu {
                Button("One") {}
                Divider()
                Button("Two", systemImage: "2.circle") {}
            } label: {
                Label("menu-label", systemImage: "ellipsis.circle")
            }
            DisclosureGroup("More", isExpanded: $open) {
                Text("disclosed")
            }
            Link("link-ok", destination: URL(string: "https://example.com")!)
            ContentUnavailableView("cu-title", systemImage: "tray", description: Text("Nothing"))
            ShareLink(item: "x")
            LabeledContent("Key", value: "Value")
            GroupBox("Box") { Text("in-box") }
        }
    }
}

struct Matrix {
    var rows: [[Int]]
    var flat: [Int] { rows.flatMap { $0 } }
    var sum: Int { flat.reduce(0, +) }
}

struct T43_MoreCollections: View {
    let m = Matrix(rows: [[1, 2], [3, 4]])
    var body: some View {
        let sorted = m.flat.sorted(by: >).map(String.init).joined()
        let uniq = Set([1, 1, 2, 3]).count
        let compact = ["1", "x", "2", "3"].compactMap { Int($0) }
        let slice = Array(m.flat[1...2])
        VStack {
            Text("flat \(m.flat.count)")
            Text("sum \(m.sum)")
            Text("sorted \(sorted)")
            Text("uniq \(uniq)")
            Text("last \(m.flat.last ?? 0)")
            Text("cmp \(compact.count)")
            Text("slice \(slice.count)")
            Text(m.flat.allSatisfy { $0 > 0 } ? "all" : "some")
            Text("\(m.flat.min() ?? 0)-\(m.flat.max() ?? 0)")
        }
    }
}

struct Feed {
    func load() async throws -> [String] {
        var out: [String] = []
        for try await line in lines() {
            out.append(line)
        }
        for await value in ticks() where value > 0 {
            out.append("\(value)")
        }
        return out
    }
    func lines() -> AsyncStream<String> { AsyncStream { $0.finish() } }
    func ticks() -> AsyncStream<Int> { AsyncStream { $0.finish() } }
}

struct T44_AsyncSequences: View {
    let feed = Feed()
    var body: some View {
        Text("async-ok")
            .task {
                _ = try? await feed.load()
            }
    }
}

struct T45_Math: View {
    var body: some View {
        VStack {
            Text("math \(Int(sqrt(25.0)))")
            Text("pow \(Int(pow(2.0, 3.0)))")
            Text("abs \(abs(-3))")
            Text("pi \(Double.pi, specifier: "%.2f")")
            Text("round \(Int((2.6).rounded()))")
            Text("clamp \(min(max(5, 0), 1))")
            Text("\(Int.random(in: 1...6) > 0 ? "rand" : "none")")
            Text(sin(0) == 0 ? "sin" : "nosin")
        }
    }
}

struct T46_Gradients: View {
    var body: some View {
        VStack {
            Text("gradients-ok")
            LinearGradient(stops: [.init(color: .blue, location: 0), .init(color: .green, location: 0.8)], startPoint: .leading, endPoint: .trailing)
            RadialGradient(colors: [.yellow, .clear], center: .init(x: 0.5, y: 0.2), startRadius: 4, endRadius: 90)
            Capsule()
                .fill(AngularGradient(colors: [.red, .blue], center: .center, startAngle: .degrees(0), endAngle: .degrees(180)))
        }
    }
}

struct T47_ListRows: View {
    var body: some View {
        List {
            Text("row-clear")
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 6, leading: 20, bottom: 6, trailing: 20))
            Text("row-plain")
        }
        .scrollContentBackground(.hidden)
    }
}

struct T48_System: View {
    var body: some View {
        VStack {
            Text("os \(ProcessInfo.processInfo.operatingSystemVersion.majorVersion)")
            Text("cores \(ProcessInfo.processInfo.processorCount)")
            Text("device \(UIDevice.current.systemName)")
            GeometryReader { proxy in
                Text("geo \(proxy.size.width > 0 ? "sized" : "empty")")
            }
        }
    }
}

#Preview {
    T08_GenericContainers()
        .environment(Counter())
        .preferredColorScheme(.dark)
}

#Preview("Named") {
    NavigationStack {
        T13_ListSections()
    }
}
