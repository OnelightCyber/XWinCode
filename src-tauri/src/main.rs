#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|a| a == "--usbmux-stdio") {
        std::process::exit(xwincode_lib::usbmux_stdio());
    }
    xwincode_lib::run()
}
