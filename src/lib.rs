pub mod support;
pub mod domain;
pub mod app;
pub mod contract;

macro_rules! placeholder_module {
    ($name:ident) => {
        pub mod $name {
            #[doc(hidden)]
            pub struct Module;
        }
    };
}

placeholder_module!(store);
placeholder_module!(rt);
placeholder_module!(http);
placeholder_module!(web);
placeholder_module!(chat);
placeholder_module!(view);
placeholder_module!(admin);
placeholder_module!(panel);
