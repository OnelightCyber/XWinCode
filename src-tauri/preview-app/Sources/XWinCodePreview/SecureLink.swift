import CryptoKit
import Foundation
import Security

enum Pairing {
    private static let service = "dev.xwincode.preview.pairing"
    private static let listKey = "xwc.pairings"

    static var ids: [String] {
        UserDefaults.standard.stringArray(forKey: listKey) ?? []
    }

    static var isPaired: Bool {
        !ids.isEmpty
    }

    static func save(id: String, key: Data) -> Bool {
        guard !id.isEmpty, id.count <= 128, key.count == 32 else { return false }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: id,
        ]
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = key
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { return false }
        var list = ids.filter { $0 != id }
        list.append(id)
        UserDefaults.standard.set(Array(list.suffix(8)), forKey: listKey)
        return true
    }

    static func key(for id: String) -> Data? {
        guard ids.contains(id) else { return nil }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: id,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data, data.count == 32 else { return nil }
        return data
    }

    static func matches(id: String, key: Data) -> Bool {
        guard let stored = self.key(for: id), stored.count == key.count else { return false }
        return zip(stored, key).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
    }

    static func forgetAll() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
        UserDefaults.standard.removeObject(forKey: listKey)
    }
}

enum Handshake {
    static func nonce() -> Data {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes)
    }

    static func mac(_ key: Data, _ label: String, _ a: Data, _ b: Data) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: Data(label.utf8) + a + b, using: SymmetricKey(data: key)))
    }

    static func verify(_ key: Data, _ label: String, _ a: Data, _ b: Data, _ code: Data) -> Bool {
        HMAC<SHA256>.isValidAuthenticationCode(code, authenticating: Data(label.utf8) + a + b, using: SymmetricKey(data: key))
    }

    static func session(_ key: Data, phone: Data, desktop: Data) -> SecureSession {
        let ikm = SymmetricKey(data: key)
        let salt = phone + desktop
        let inbound = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: salt, info: Data("xwc desktop to phone".utf8), outputByteCount: 32)
        let outbound = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: salt, info: Data("xwc phone to desktop".utf8), outputByteCount: 32)
        return SecureSession(inbound: inbound, outbound: outbound)
    }
}

final class SecureSession {
    private let inbound: SymmetricKey
    private let outbound: SymmetricKey
    private var sent: UInt64 = 0
    private var received: UInt64 = 0

    init(inbound: SymmetricKey, outbound: SymmetricKey) {
        self.inbound = inbound
        self.outbound = outbound
    }

    private static func nonce(_ counter: UInt64) -> Data {
        var data = Data(repeating: 0, count: 4)
        withUnsafeBytes(of: counter.bigEndian) { data.append(contentsOf: $0) }
        return data
    }

    func seal(_ plain: Data) -> Data? {
        guard let nonce = try? ChaChaPoly.Nonce(data: Self.nonce(sent)),
              let box = try? ChaChaPoly.seal(plain, using: outbound, nonce: nonce) else { return nil }
        sent &+= 1
        return box.combined
    }

    func open(_ data: Data) -> Data? {
        guard data.count >= 28, data.prefix(12) == Self.nonce(received),
              let box = try? ChaChaPoly.SealedBox(combined: data),
              let plain = try? ChaChaPoly.open(box, using: inbound) else { return nil }
        received &+= 1
        return plain
    }
}
