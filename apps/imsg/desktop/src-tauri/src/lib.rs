use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

fn build_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let new_message = MenuItemBuilder::with_id("conversation.new", "New Message")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let close = MenuItemBuilder::with_id("navigation.close", "Close")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let find = MenuItemBuilder::with_id("conversation.find", "Find in Conversation")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let search = MenuItemBuilder::with_id("palette.open", "Search")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&new_message)
        .separator()
        .item(&close)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let find_menu = SubmenuBuilder::new(app, "Find")
        .item(&find)
        .item(&search)
        .build()?;

    MenuBuilder::new(app)
        .item(&file)
        .item(&edit)
        .item(&find_menu)
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let menu = build_menu(app)?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("imsg-shortcut", id);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
