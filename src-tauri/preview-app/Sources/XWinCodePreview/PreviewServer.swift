import Foundation
import Network
import ReplayKit
import SwiftUI
import UIKit

struct PairRequest: Identifiable {
    let id: String
    let key: Data
    let name: String
}

struct Render {
    let tree: ViewNode?
    let scheme: ColorScheme?
    let title: String
    let typeSize: DynamicTypeSize?
    let animation: Animation?
}

enum Incoming {
    case render(Render)
    case fonts([JSONValue])
    case pair(PairRequest)
    case record(Bool)
    case ping
    case ignored

    init(_ data: Data) {
        guard let json = JSONValue.parse(data), let type = json["type"]?.string else {
            self = .ignored
            return
        }
        switch type {
        case "ping":
            self = .ping
        case "fonts":
            self = .fonts(json["fonts"]?.array ?? [])
        case "record":
            self = .record(json["on"]?.bool ?? false)
        case "pair":
            guard let id = json["id"]?.string, let text = json["key"]?.string, let key = Data(base64Encoded: text), key.count == 32 else {
                self = .ignored
                return
            }
            var scalars = String.UnicodeScalarView()
            scalars.append(contentsOf: (json["name"]?.string ?? "").unicodeScalars.filter {
                ![.control, .format, .lineSeparator, .paragraphSeparator].contains($0.properties.generalCategory)
            }.prefix(64))
            let name = String(scalars).trimmingCharacters(in: .whitespaces)
            self = .pair(PairRequest(id: id, key: key, name: name.isEmpty ? "your PC" : name))
        case "render":
            let tree = json["tree"].flatMap { ViewNode.root($0) }
            let scheme: ColorScheme?
            switch json["scheme"]?.string {
            case "light": scheme = .light
            case "dark": scheme = .dark
            default: scheme = nil
            }
            let animation: Animation? = json["animation"]?.object == nil ? nil : Motion.animation(json["animation"])
            self = .render(Render(tree: tree, scheme: scheme, title: json["title"]?.text ?? "", typeSize: Typography.dynamicType(json["typeSize"]?.string), animation: animation))
        default:
            self = .ignored
        }
    }
}

@MainActor
final class PreviewServer: ObservableObject {
    static let port: NWEndpoint.Port = 7878
    static let wifiPort: NWEndpoint.Port = 7879
    static let maxFrame = 16 * 1024 * 1024

    @Published private(set) var tree: ViewNode?
    @Published private(set) var scheme: ColorScheme?
    @Published private(set) var title = ""
    @Published private(set) var typeSize: DynamicTypeSize?
    @Published private(set) var fontsVersion = 0
    @Published private(set) var connected = false
    @Published private(set) var problem: String?
    @Published private(set) var paired = Pairing.isPaired
    @Published private(set) var wifiReady = false
    @Published private(set) var pairRequest: PairRequest?

    private var listener: NWListener?
    private var wifiListener: NWListener?
    private var connection: NWConnection?
    private var overWifi = false
    private var secure: SecureSession?
    private var challenge: Data?
    private var failures: [String: [Date]] = [:]
    private var pendingSince: Date?
    private var pendingHost = ""
    private var declined: Set<String> = []
    private var recording = false
    private var uploading = false
    private var uploadFile: URL?
    private var recordLimit: Task<Void, Never>?
    private var ready = false
    private var session = 0
    private var pending: Render?
    private var applying = false
    private var restart: Task<Void, Never>?
    private let decoder = DispatchQueue(label: "dev.xwincode.preview.decode", qos: .userInitiated)

    private lazy var stats = DeviceStats { [weak self] message in
        self?.send(message)
    }

    lazy var events = PreviewEvents { [weak self] id, kind, value in
        self?.sendEvent(id: id, kind: kind, value: value)
    }

    func start() {
        guard listener == nil else { return }
        restart?.cancel()
        restart = nil
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        let parameters = NWParameters(tls: nil, tcp: tcp)
        parameters.allowLocalEndpointReuse = true
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: Self.port)
        let listener: NWListener
        do {
            listener = try NWListener(using: parameters)
        } catch {
            problem = String(describing: error)
            scheduleRestart()
            return
        }
        listener.stateUpdateHandler = { [weak self, weak listener] state in
            MainActor.assumeIsolated {
                guard let self, let listener else { return }
                self.listenerChanged(listener, state)
            }
        }
        listener.newConnectionHandler = { [weak self] incoming in
            MainActor.assumeIsolated {
                guard let self else {
                    incoming.cancel()
                    return
                }
                self.accept(incoming)
            }
        }
        self.listener = listener
        listener.start(queue: .main)
        startWifi()
    }

    func resume() {
        if listener == nil {
            start()
        } else if wifiListener == nil {
            startWifi()
        }
    }

    func unpair() {
        Pairing.forgetAll()
        paired = false
        stopWifi()
        if overWifi {
            close()
        }
    }

    private func startWifi() {
        guard Pairing.isPaired, wifiListener == nil else { return }
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        let parameters = NWParameters(tls: nil, tcp: tcp)
        parameters.allowLocalEndpointReuse = true
        guard let wifi = try? NWListener(using: parameters, on: Self.wifiPort) else { return }
        wifi.stateUpdateHandler = { [weak self, weak wifi] state in
            MainActor.assumeIsolated {
                guard let self, let wifi, wifi === self.wifiListener else { return }
                switch state {
                case .ready:
                    self.wifiReady = true
                case .failed, .cancelled:
                    self.wifiReady = false
                    self.wifiListener = nil
                default:
                    break
                }
            }
        }
        wifi.newConnectionHandler = { [weak self] incoming in
            MainActor.assumeIsolated {
                guard let self else {
                    incoming.cancel()
                    return
                }
                self.acceptWifi(incoming)
            }
        }
        wifiListener = wifi
        wifi.start(queue: .main)
    }

    private func stopWifi() {
        wifiListener?.newConnectionHandler = nil
        wifiListener?.cancel()
        wifiListener = nil
        wifiReady = false
    }

    private func acceptWifi(_ incoming: NWConnection) {
        let now = Date()
        failures = failures.compactMapValues { dates in
            let recent = dates.filter { now.timeIntervalSince($0) < 60 }
            return recent.isEmpty ? nil : recent
        }
        guard Pairing.isPaired, failures[Self.hostKey(incoming.endpoint), default: []].count < 5 else {
            incoming.cancel()
            return
        }
        if connection != nil {
            guard overWifi, secure == nil, let since = pendingSince, now.timeIntervalSince(since) >= 1 else {
                incoming.cancel()
                return
            }
            failPending()
        }
        open(incoming, wifi: true)
    }

    private func failPending() {
        failures[pendingHost, default: []].append(Date())
        close()
    }

    func answerPairing(_ allow: Bool) {
        guard let request = pairRequest else { return }
        pairRequest = nil
        guard allow else {
            declined.insert(request.id)
            return
        }
        guard Pairing.save(id: request.id, key: request.key) else { return }
        paired = true
        startWifi()
    }

    func sendEvent(id: String, kind: String, value: JSONValue) {
        send(JSONValue.message([
            ("type", .string("event")),
            ("id", .string(id)),
            ("kind", .string(kind)),
            ("value", value),
        ]))
    }

    private func listenerChanged(_ source: NWListener, _ state: NWListener.State) {
        guard source === listener else { return }
        switch state {
        case .ready:
            problem = nil
        case .waiting(let error):
            problem = String(describing: error)
        case .failed(let error):
            problem = String(describing: error)
            source.stateUpdateHandler = nil
            source.newConnectionHandler = nil
            source.cancel()
            listener = nil
            scheduleRestart()
        case .cancelled:
            listener = nil
        default:
            break
        }
    }

    private func scheduleRestart() {
        restart?.cancel()
        restart = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            self?.retry()
        }
    }

    private func retry() {
        restart = nil
        guard UIApplication.shared.applicationState != .background else { return }
        start()
    }

    private func accept(_ incoming: NWConnection) {
        guard Self.isLoopback(incoming.endpoint) else {
            incoming.cancel()
            return
        }
        if connection != nil {
            close()
        }
        open(incoming, wifi: false)
    }

    private func open(_ incoming: NWConnection, wifi: Bool) {
        session &+= 1
        let id = session
        connection = incoming
        overWifi = wifi
        secure = nil
        challenge = nil
        pendingSince = wifi ? Date() : nil
        pendingHost = wifi ? Self.hostKey(incoming.endpoint) : ""
        incoming.stateUpdateHandler = { [weak self, weak incoming] state in
            MainActor.assumeIsolated {
                guard let self, let incoming else { return }
                self.connectionChanged(incoming, id, state)
            }
        }
        incoming.start(queue: .main)
        if wifi {
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(5))
                guard let self, self.session == id, self.overWifi, self.secure == nil else { return }
                self.failPending()
            }
        }
    }

    private func connectionChanged(_ link: NWConnection, _ id: Int, _ state: NWConnection.State) {
        guard link === connection, id == session else { return }
        switch state {
        case .ready:
            ready = true
            if overWifi {
                let nonce = Handshake.nonce()
                challenge = nonce
                sendPlain(JSONValue.message([("type", .string("challenge")), ("version", .number(1)), ("nonce", .string(nonce.base64EncodedString()))]))
            } else {
                connected = true
                sendHello()
                stats.start()
            }
            readHeader(link, id)
        case .failed, .cancelled:
            close()
        default:
            break
        }
    }

    private func close() {
        stats.stop()
        cancelRecording()
        if let link = connection {
            link.stateUpdateHandler = nil
            link.cancel()
        }
        connection = nil
        ready = false
        overWifi = false
        secure = nil
        challenge = nil
        pendingSince = nil
        pendingHost = ""
        session &+= 1
        pending = nil
        if connected { connected = false }
        if tree != nil { tree = nil }
        if scheme != nil { scheme = nil }
        if !title.isEmpty { title = "" }
    }

    private func readHeader(_ link: NWConnection, _ id: Int) {
        link.receive(minimumIncompleteLength: 4, maximumLength: 4) { [weak self] data, _, _, error in
            MainActor.assumeIsolated {
                guard let self, link === self.connection, id == self.session else { return }
                guard error == nil, let data, data.count == 4 else {
                    self.close()
                    return
                }
                let bytes = [UInt8](data)
                let length = Int(bytes[0]) << 24 | Int(bytes[1]) << 16 | Int(bytes[2]) << 8 | Int(bytes[3])
                if self.overWifi && self.secure == nil && length > 4096 {
                    self.failPending()
                } else if length > Self.maxFrame + 64 {
                    self.close()
                } else if length == 0 {
                    self.readHeader(link, id)
                } else {
                    self.readBody(link, id, length)
                }
            }
        }
    }

    private func readBody(_ link: NWConnection, _ id: Int, _ length: Int) {
        link.receive(minimumIncompleteLength: length, maximumLength: length) { [weak self] data, _, _, error in
            MainActor.assumeIsolated {
                guard let self, link === self.connection, id == self.session else { return }
                guard error == nil, let data, data.count == length else {
                    self.close()
                    return
                }
                if self.overWifi {
                    if let secure = self.secure {
                        guard let plain = secure.open(data) else {
                            self.close()
                            return
                        }
                        self.decode(plain, id)
                    } else {
                        guard self.authenticate(data) else {
                            self.failPending()
                            return
                        }
                    }
                } else {
                    self.decode(data, id)
                }
                self.readHeader(link, id)
            }
        }
    }

    private func decode(_ data: Data, _ id: Int) {
        decoder.async { [weak self] in
            let message = Incoming(data)
            DispatchQueue.main.async { [weak self] in
                MainActor.assumeIsolated {
                    self?.handle(message, id)
                }
            }
        }
    }

    private func handle(_ message: Incoming, _ id: Int) {
        guard id == session, ready else { return }
        switch message {
        case .ping:
            send(JSONValue.message([("type", .string("pong"))]))
        case .fonts(let fonts):
            if FontStore.register(fonts) {
                fontsVersion &+= 1
            }
        case .record(let on):
            if on {
                startRecording()
            } else {
                stopRecording()
            }
        case .pair(let request):
            guard !overWifi else { return }
            if Pairing.matches(id: request.id, key: request.key) {
                startWifi()
            } else if pairRequest == nil, !declined.contains(request.id) {
                pairRequest = request
            }
        case .render(let render):
            pending = render
            guard !applying else { return }
            applying = true
            DispatchQueue.main.async { [weak self] in
                MainActor.assumeIsolated {
                    self?.applyPending()
                }
            }
        case .ignored:
            break
        }
    }

    private func applyPending() {
        applying = false
        guard let render = pending else { return }
        pending = nil
        if let animation = render.animation {
            withAnimation(animation) {
                tree = render.tree
            }
        } else {
            tree = render.tree
        }
        scheme = render.scheme
        title = render.title
        if typeSize != render.typeSize { typeSize = render.typeSize }
    }

    private func sendRecording(_ state: String, _ message: String? = nil) {
        var fields: [(String, JSONValue)] = [("type", .string("recording")), ("state", .string(state))]
        if let message {
            fields.append(("message", .string(message)))
        }
        send(JSONValue.message(fields))
    }

    private func startRecording() {
        let recorder = RPScreenRecorder.shared()
        guard !recording, !uploading else { return }
        guard recorder.isAvailable else {
            sendRecording("error", "Screen recording isn't available right now.")
            return
        }
        recorder.isMicrophoneEnabled = false
        let id = session
        recorder.startRecording { [weak self] error in
            let message = error?.localizedDescription
            Task { @MainActor [weak self] in
                guard let self else { return }
                if let message {
                    self.sendRecording("error", message)
                    return
                }
                guard self.session == id else {
                    Self.discard()
                    return
                }
                self.recording = true
                self.sendRecording("on")
                self.recordLimit = Task { @MainActor [weak self] in
                    try? await Task.sleep(for: .seconds(180))
                    guard !Task.isCancelled else { return }
                    self?.stopRecording()
                }
            }
        }
    }

    private func stopRecording() {
        recordLimit?.cancel()
        recordLimit = nil
        guard recording else { return }
        recording = false
        uploading = true
        let id = session
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("XWinCode-\(UUID().uuidString).mp4")
        RPScreenRecorder.shared().stopRecording(withOutput: url) { [weak self] error in
            let message = error?.localizedDescription
            Task { @MainActor [weak self] in
                guard let self else {
                    try? FileManager.default.removeItem(at: url)
                    return
                }
                guard message == nil, self.session == id, let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
                    self.finishUpload(url)
                    self.sendRecording("error", message ?? "The recording couldn't be read.")
                    return
                }
                self.uploadFile = url
                self.upload(data, url, id, 0)
            }
        }
    }

    private func upload(_ data: Data, _ url: URL, _ id: Int, _ part: Int) {
        let chunk = 1536 * 1024
        let parts = max(1, (data.count + chunk - 1) / chunk)
        guard session == id, ready else {
            finishUpload(url)
            return
        }
        let range = (part * chunk)..<min(data.count, (part + 1) * chunk)
        let message = "{\"type\":\"video\",\"part\":\(part),\"parts\":\(parts),\"data\":\"" + data.subdata(in: range).base64EncodedString() + "\"}"
        send(message) { [weak self] in
            guard let self else { return }
            if part + 1 < parts {
                self.upload(data, url, id, part + 1)
            } else {
                self.finishUpload(url)
            }
        }
    }

    private func finishUpload(_ url: URL) {
        uploading = false
        uploadFile = nil
        try? FileManager.default.removeItem(at: url)
    }

    private func cancelRecording() {
        recordLimit?.cancel()
        recordLimit = nil
        if let file = uploadFile {
            try? FileManager.default.removeItem(at: file)
            uploadFile = nil
        }
        uploading = false
        guard recording else { return }
        recording = false
        Self.discard()
    }

    private static func discard() {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("XWinCode-\(UUID().uuidString).mp4")
        RPScreenRecorder.shared().stopRecording(withOutput: url) { _ in
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func sendHello() {
        let device = UIDevice.current
        let screen = DeviceStats.screen
        let bounds = screen?.fixedCoordinateSpace.bounds ?? .zero
        send(JSONValue.message([
            ("type", .string("hello")),
            ("version", .number(1)),
            ("name", .string(device.name)),
            ("model", .string(device.model)),
            ("machine", .string(DeviceStats.machine)),
            ("system", .string(device.systemVersion)),
            ("width", .number(Double(bounds.width))),
            ("height", .number(Double(bounds.height))),
            ("scale", .number(Double(screen?.scale ?? 1))),
            ("maxFps", .number(Double(DeviceStats.maxFps))),
        ]))
    }

    private func authenticate(_ data: Data) -> Bool {
        guard let phone = challenge,
              let json = JSONValue.parse(data),
              json["type"]?.string == "auth",
              let pairId = json["id"]?.string,
              let desktop = json["nonce"]?.string.flatMap({ Data(base64Encoded: $0) }), desktop.count == 32,
              let code = json["mac"]?.string.flatMap({ Data(base64Encoded: $0) }),
              let key = Pairing.key(for: pairId),
              Handshake.verify(key, "xwc-auth1", phone, desktop, code) else { return false }
        challenge = nil
        pendingSince = nil
        sendPlain(JSONValue.message([("type", .string("welcome")), ("mac", .string(Handshake.mac(key, "xwc-auth2", desktop, phone).base64EncodedString()))]))
        secure = Handshake.session(key, phone: phone, desktop: desktop)
        connected = true
        sendHello()
        stats.start()
        return true
    }

    private func sendPlain(_ text: String) {
        guard ready, let link = connection else { return }
        write(Data(text.utf8), to: link)
    }

    private func send(_ text: String, then: (@MainActor @Sendable () -> Void)? = nil) {
        guard ready, let link = connection else { return }
        var body = Data(text.utf8)
        guard body.count <= Self.maxFrame else { return }
        if overWifi {
            guard let secure, let sealed = secure.seal(body) else { return }
            body = sealed
        }
        write(body, to: link, then: then)
    }

    private func write(_ body: Data, to link: NWConnection, then: (@MainActor @Sendable () -> Void)? = nil) {
        let size = UInt32(body.count)
        var frame = Data(capacity: body.count + 4)
        frame.append(contentsOf: [
            UInt8((size >> 24) & 0xFF),
            UInt8((size >> 16) & 0xFF),
            UInt8((size >> 8) & 0xFF),
            UInt8(size & 0xFF),
        ])
        frame.append(body)
        link.send(content: frame, completion: .contentProcessed { [weak self, weak link] error in
            MainActor.assumeIsolated {
                guard error != nil else {
                    then?()
                    return
                }
                guard let self, let link, link === self.connection else { return }
                self.close()
            }
        })
    }

    nonisolated static func hostKey(_ endpoint: NWEndpoint) -> String {
        guard case let .hostPort(host, _) = endpoint else { return "" }
        switch host {
        case let .ipv4(address):
            return address.rawValue.map { String($0) }.joined(separator: ".")
        case let .ipv6(address):
            if let v4 = address.asIPv4 {
                return v4.rawValue.map { String($0) }.joined(separator: ".")
            }
            return address.rawValue.prefix(8).map { String(format: "%02x", $0) }.joined()
        case let .name(name, _):
            return name
        @unknown default:
            return ""
        }
    }

    nonisolated static func isLoopback(_ endpoint: NWEndpoint) -> Bool {
        guard case let .hostPort(host, _) = endpoint else { return false }
        switch host {
        case let .ipv4(address):
            return address.isLoopback
        case let .ipv6(address):
            return address.isLoopback || address.asIPv4?.isLoopback == true
        case let .name(name, _):
            return name == "localhost"
        @unknown default:
            return false
        }
    }
}
