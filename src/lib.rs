pub mod support;

macro_rules! root_module {
    ($name:ident) => {
        pub mod $name {
            pub const NAME: &str = stringify!($name);
        }
    };
}

root_module!(domain);
root_module!(app);
root_module!(contract);
root_module!(store);
root_module!(rt);
root_module!(http);
root_module!(web);
root_module!(chat);
root_module!(view);
root_module!(admin);
root_module!(panel);

pub fn root_modules() -> [&'static str; 12] {
    [
        domain::NAME,
        app::NAME,
        contract::NAME,
        store::NAME,
        rt::NAME,
        http::NAME,
        web::NAME,
        chat::NAME,
        view::NAME,
        admin::NAME,
        panel::NAME,
        support::MODULE_NAME,
    ]
}
