import type { TKey } from "../i18n";

export type LibraryCategory = "views" | "modifiers" | "code";

export interface LibraryItem {
  id: string;
  name: string;
  category: LibraryCategory;
  snippet: string;
  desc: TKey;
}

const item = (id: string, name: string, category: LibraryCategory, snippet: string): LibraryItem => ({
  id,
  name,
  category,
  snippet,
  desc: `lib.${id}` as TKey,
});

export const LIBRARY: LibraryItem[] = [
  item("text", "Text", "views", 'Text("${1:Hello}")'),
  item("label", "Label", "views", 'Label("${1:Title}", systemImage: "${2:star}")'),
  item("image", "Image", "views", 'Image(systemName: "${1:star.fill}")'),
  item("asyncImage", "AsyncImage", "views", 'AsyncImage(url: URL(string: "${1:https://example.com/image.png}")) { image in\n\timage.resizable().scaledToFit()\n} placeholder: {\n\tProgressView()\n}'),
  item("button", "Button", "views", 'Button("${1:Tap Me}") {\n\t$0\n}'),
  item("toggle", "Toggle", "views", 'Toggle("${1:Enabled}", isOn: $${2:isOn})'),
  item("slider", "Slider", "views", "Slider(value: $${1:value}, in: ${2:0...1})"),
  item("stepper", "Stepper", "views", 'Stepper("${1:Count}: \\(${2:count})", value: $${2:count}, in: ${3:0...10})'),
  item("textField", "TextField", "views", 'TextField("${1:Placeholder}", text: $${2:text})'),
  item("secureField", "SecureField", "views", 'SecureField("${1:Password}", text: $${2:password})'),
  item("picker", "Picker", "views", 'Picker("${1:Choice}", selection: $${2:selection}) {\n\tText("${3:One}").tag(0)\n\tText("${4:Two}").tag(1)\n}'),
  item("datePicker", "DatePicker", "views", 'DatePicker("${1:Date}", selection: $${2:date})'),
  item("progress", "ProgressView", "views", "ProgressView(value: ${1:0.5})"),
  item("vstack", "VStack", "views", "VStack(spacing: ${1:12}) {\n\t$0\n}"),
  item("hstack", "HStack", "views", "HStack(spacing: ${1:12}) {\n\t$0\n}"),
  item("zstack", "ZStack", "views", "ZStack {\n\t$0\n}"),
  item("spacer", "Spacer", "views", "Spacer()"),
  item("divider", "Divider", "views", "Divider()"),
  item("list", "List", "views", "List(${1:items}, id: \\.self) { ${2:item} in\n\tText(${2:item})\n}"),
  item("forEach", "ForEach", "views", "ForEach(${1:items}, id: \\.self) { ${2:item} in\n\t$0\n}"),
  item("scrollView", "ScrollView", "views", "ScrollView {\n\t$0\n}"),
  item("navigationStack", "NavigationStack", "views", 'NavigationStack {\n\t${1:List {\n\t\tText("Row")\n\t}}\n\t.navigationTitle("${2:Title}")\n}'),
  item("navigationLink", "NavigationLink", "views", 'NavigationLink("${1:Details}") {\n\t${2:Text("Detail")}\n}'),
  item("tabView", "TabView", "views", 'TabView {\n\tTab("${1:Home}", systemImage: "${2:house}") {\n\t\t${3:Text("Home")}\n\t}\n}'),
  item("form", "Form", "views", 'Form {\n\tSection("${1:Section}") {\n\t\t$0\n\t}\n}'),
  item("grid", "LazyVGrid", "views", "LazyVGrid(columns: [GridItem(.adaptive(minimum: ${1:100}))]) {\n\t$0\n}"),
  item("menu", "Menu", "views", 'Menu("${1:Options}") {\n\tButton("${2:Action}") {}\n}'),
  item("shareLink", "ShareLink", "views", 'ShareLink(item: URL(string: "${1:https://swift.org}")!)'),
  item("contentUnavailable", "ContentUnavailableView", "views", 'ContentUnavailableView("${1:No Items}", systemImage: "${2:tray}", description: Text("${3:Add something to get started.}"))'),
  item("map", "Map", "views", "Map()"),
  item("chart", "Chart", "views", 'Chart(${1:data}) { point in\n\tBarMark(x: .value("${2:Day}", point.${3:day}), y: .value("${4:Value}", point.${5:value}))\n}'),

  item("padding", ".padding()", "modifiers", ".padding(${1})"),
  item("font", ".font()", "modifiers", ".font(.${1:headline})"),
  item("foregroundStyle", ".foregroundStyle()", "modifiers", ".foregroundStyle(.${1:secondary})"),
  item("background", ".background()", "modifiers", ".background(${1:.thinMaterial}, in: .rect(cornerRadius: ${2:12}))"),
  item("frame", ".frame()", "modifiers", ".frame(maxWidth: ${1:.infinity}, alignment: .${2:leading})"),
  item("clipShape", ".clipShape()", "modifiers", ".clipShape(.rect(cornerRadius: ${1:16}))"),
  item("shadow", ".shadow()", "modifiers", ".shadow(radius: ${1:8})"),
  item("opacity", ".opacity()", "modifiers", ".opacity(${1:0.5})"),
  item("glassEffect", ".glassEffect()", "modifiers", ".glassEffect()"),
  item("buttonStyle", ".buttonStyle()", "modifiers", ".buttonStyle(.${1:borderedProminent})"),
  item("onTapGesture", ".onTapGesture", "modifiers", ".onTapGesture {\n\t$0\n}"),
  item("animation", ".animation()", "modifiers", ".animation(.${1:spring}, value: ${2:value})"),
  item("sheet", ".sheet()", "modifiers", ".sheet(isPresented: $${1:showSheet}) {\n\t$0\n}"),
  item("alert", ".alert()", "modifiers", '.alert("${1:Title}", isPresented: $${2:showAlert}) {\n\tButton("OK") {}\n}'),
  item("navigationTitle", ".navigationTitle()", "modifiers", '.navigationTitle("${1:Title}")'),
  item("toolbar", ".toolbar", "modifiers", ".toolbar {\n\tToolbarItem(placement: .${1:primaryAction}) {\n\t\t$0\n\t}\n}"),
  item("task", ".task", "modifiers", ".task {\n\t$0\n}"),
  item("onAppear", ".onAppear", "modifiers", ".onAppear {\n\t$0\n}"),
  item("refreshable", ".refreshable", "modifiers", ".refreshable {\n\t$0\n}"),
  item("searchable", ".searchable()", "modifiers", ".searchable(text: $${1:query})"),

  item("view", "View", "code", 'struct ${1:NewView}: View {\n\tvar body: some View {\n\t\t${2:Text("Hello")}\n\t}\n}'),
  item("state", "@State", "code", "@State private var ${1:name} = ${2:value}"),
  item("binding", "@Binding", "code", "@Binding var ${1:name}: ${2:Bool}"),
  item("observable", "@Observable", "code", "@Observable\nfinal class ${1:Model} {\n\tvar ${2:items}: [String] = []\n}"),
  item("environment", "@Environment", "code", "@Environment(\\.${1:dismiss}) private var ${1:dismiss}"),
  item("appStorage", "@AppStorage", "code", '@AppStorage("${1:key}") private var ${2:value} = ${3:false}'),
  item("preview", "#Preview", "code", "#Preview {\n\t${1:ContentView()}\n}"),
  item("asyncFunc", "async func", "code", "func ${1:load}() async throws {\n\t$0\n}"),
  item("urlSession", "URLSession", "code", 'let (data, _) = try await URLSession.shared.data(from: URL(string: "${1:https://example.com}")!)'),
  item("logger", "Logger", "code", 'import OSLog\n\nlet logger = Logger(subsystem: "${1:app}", category: "${2:main}")\n\nlogger.info("${3:Loaded} \\(${4:value}, privacy: .public)")'),
  item("nslog", "NSLog", "code", 'NSLog("${1:Value}: %@", String(describing: ${2:value}))'),
  item("haptics", "Haptics", "code", "UIImpactFeedbackGenerator(style: .${1:medium}).impactOccurred()"),
];

export function previewSnippet(snippet: string): string {
  return snippet
    .replace(/\$\{\d+:((?:[^{}]|\{[^{}]*\})*)\}/g, "$1")
    .replace(/\$\{\d+\}/g, "")
    .replace(/\$\d+/g, "")
    .replace(/\t/g, "    ");
}
