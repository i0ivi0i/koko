pub mod support;

macro_rules! placeholder_module {
    ($name:ident) => {
        pub(crate) mod $name {
            #[allow(dead_code)]
            pub(crate) struct Module;
        }
    };
}

placeholder_module!(domain);
placeholder_module!(app);
placeholder_module!(contract);
placeholder_module!(store);
placeholder_module!(rt);
placeholder_module!(http);
placeholder_module!(web);
placeholder_module!(chat);
placeholder_module!(view);
placeholder_module!(admin);
placeholder_module!(panel);
