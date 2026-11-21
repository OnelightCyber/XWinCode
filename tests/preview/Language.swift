import SwiftUI

enum Outline {
    case circle(radius: Double)
    case square(side: Double)
    case dot
}

struct L01_SwitchGuards: View {
    let value = 42
    let outline = Outline.circle(radius: 3)
    var body: some View {
        VStack {
            switch value {
            case let x where x > 100:
                Text("huge")
            case let x where x > 10:
                Text("big \(x)")
            default:
                Text("small")
            }
            switch outline {
            case .circle(let r) where r > 2:
                Text("wide circle")
            case .circle:
                Text("circle")
            default:
                Text("other")
            }
        }
    }
}

class Animal {
    var name = "animal"
    func speak() -> String { "..." }
}

final class Dog: Animal {
    var tricks: Int
    init(tricks: Int) {
        self.tricks = tricks
        super.init()
        name = "dog"
    }
    override func speak() -> String { "woof \(tricks)" }
}

struct L02_Classes: View {
    let pet: Animal = Dog(tricks: 3)
    var body: some View {
        VStack {
            Text(pet.name)
            Text(pet.speak())
            if let dog = pet as? Dog {
                Text("tricks \(dog.tricks)")
            }
            if pet is Dog {
                Text("is-dog")
            }
            switch pet {
            case is Dog:
                Text("case-dog")
            default:
                Text("case-other")
            }
        }
    }
}

struct L03_Ranges: View {
    let items = [10, 20, 30, 40, 50]
    var body: some View {
        let tail = items[2...]
        let head = items[..<2]
        let upto = items[...1]
        let big = (0..<5000).reduce(0, +)
        let inside = (0.0...1.0).contains(1.5)
        let limits = 0.0...100.0
        let clamped = min(max(140.0, limits.lowerBound), limits.upperBound)
        VStack {
            Text("tail \(tail.count)")
            Text("head \(head.count)")
            Text("upto \(upto.count)")
            Text("big \(big)")
            Text("inside \(inside)")
            Text("clamped \(Int(clamped))")
        }
    }
}

struct Temperature {
    var celsius: Double = 20 {
        willSet { history.append(celsius) }
    }
    var history: [Double] = []
    var fahrenheit: Double {
        get { celsius * 9 / 5 + 32 }
        set { celsius = (newValue - 32) * 5 / 9 }
    }
}

struct L04_Accessors: View {
    var body: some View {
        var t = Temperature()
        t.fahrenheit = 212
        t.celsius = 30
        return VStack {
            Text("c \(Int(t.celsius))")
            Text("f \(Int(t.fahrenheit))")
            Text("history \(t.history.count)")
        }
    }
}

struct L05_Formats: View {
    let price = 1234.5
    let when = Date(timeIntervalSince1970: 15_000_000)
    var body: some View {
        VStack {
            Text(price, format: .currency(code: "EUR"))
            Text("total \(price, format: .number.precision(.fractionLength(0)))")
            Text(0.256, format: .percent.precision(.fractionLength(1)))
            Text("year \(Calendar.current.component(.year, from: when))")
            Text("later \(Int(when.addingTimeInterval(60).timeIntervalSince(when)))")
        }
    }
}

struct Loader {
    func load() async -> Int {
        async let a = fetch(1)
        async let b = fetch(2)
        return await a + b
    }
    func fetch(_ n: Int) async -> Int { n * 10 }
}

struct L06_AsyncLet: View {
    @State private var total = 0
    var body: some View {
        Text("total \(total)")
            .task { total = await Loader().load() }
    }
}

struct Badge: View {
    let label: String
    var body: some View {
        Text(label)
            .padding(6)
            .glassEffect(.regular.tint(.blue), in: .rect(cornerRadius: 8))
    }
}

struct L07_Robustness: View {
    let values: [Int] = []
    var body: some View {
        VStack {
            Text("before")
            Text("first \(values[3])")
            Badge(label: "after")
            MysteryLibraryStack(spacing: 4) {
                Text("inside-mystery")
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") {}
            }
        }
        .safeAreaInset(edge: .bottom) {
            Text("inset-text")
        }
    }
}
