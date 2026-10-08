import SwiftUI
import UIKit

@main
struct XWinCodePreviewApp: App {
    @StateObject private var server = PreviewServer()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView(server: server)
        }
        .onChange(of: phase) { _, phase in
            guard phase == .active else { return }
            UIApplication.shared.isIdleTimerDisabled = true
            server.resume()
        }
    }
}

struct RootView: View {
    @ObservedObject var server: PreviewServer

    var body: some View {
        let tree = server.connected ? server.tree : nil
        let scheme = tree == nil ? nil : server.scheme
        Group {
            if let tree {
                NodeView(node: tree, depth: 0)
                    .id("\(tree.id)#\(server.fontsVersion)")
                    .dynamicTypeSize(server.typeSize ?? .large)
            } else {
                WaitingView(connected: server.connected, problem: server.problem, paired: server.paired, wifiReady: server.wifiReady, unpair: server.unpair)
            }
        }
        .preferredColorScheme(scheme)
        .environment(\.previewEvents, server.events)
        .environment(\.openURL, OpenURLAction { url in
            ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") ? .systemAction : .discarded
        })
        .alert(
            Text(verbatim: "Use Live over Wi-Fi with \u{201C}\(server.pairRequest?.name ?? "your PC")\u{201D}?"),
            isPresented: Binding(get: { server.pairRequest != nil }, set: { if !$0 { server.answerPairing(false) } }),
            presenting: server.pairRequest
        ) { _ in
            Button("Allow") { server.answerPairing(true) }
            Button("Don\u{2019}t Allow", role: .cancel) { server.answerPairing(false) }
        } message: { _ in
            Text(verbatim: "This PC will be able to show previews on this iPhone over Wi-Fi, without a cable. Only allow a PC you own.")
        }
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            server.start()
        }
        .onChange(of: scheme) { _, value in
            if value == nil, tree?.schemed != true {
                WindowStyle.followSystem()
            }
        }
        .onChange(of: tree == nil) { _, empty in
            if empty {
                WindowStyle.followSystem()
            }
        }
    }
}

@MainActor
enum WindowStyle {
    static func followSystem() {
        for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
            for window in scene.windows {
                if window.overrideUserInterfaceStyle != .unspecified {
                    window.overrideUserInterfaceStyle = .unspecified
                }
                if let root = window.rootViewController, root.overrideUserInterfaceStyle != .unspecified {
                    root.overrideUserInterfaceStyle = .unspecified
                }
            }
        }
    }
}
