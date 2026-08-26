import Foundation

/// 起動引数から値を取り出す小道具。MarketDocket では `AppRootView.swift` の
/// 末尾に置かれていたが、あのファイルは 2つ目の App 本体なので移植していない
/// (2026-08-26 の移植)。使うのはこの補助だけなのでここに切り出す。
extension Array where Element == String {
    func value(after flag: String) -> String? {
        guard let index = firstIndex(of: flag), indices.contains(index + 1) else { return nil }
        return self[index + 1]
    }
}
