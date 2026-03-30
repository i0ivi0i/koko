pub mod app;
pub mod chat;
pub mod contract;
pub mod domain;
pub mod http;
pub mod rt;
pub mod store;
pub mod support;
pub mod view;
pub mod web;

macro_rules! placeholder_module {
    ($name:ident) => {
        pub mod $name {
            #[doc(hidden)]
            pub struct Module;
        }
    };
}

placeholder_module!(admin);
placeholder_module!(panel);
