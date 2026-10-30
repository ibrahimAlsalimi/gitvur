; TypeScript / TSX captures used by the extractor. Each pattern captures a whole node;
; `src/lang/typescript.rs` reads the node's fields and applies the node rules
; (methods only inside a class body, `const` arrows only at module level).

(class_declaration) @definition
(abstract_class_declaration) @definition
(method_definition) @definition
(function_declaration) @definition
(generator_function_declaration) @definition
(lexical_declaration) @const
(call_expression) @call
(new_expression) @call
(import_statement) @import
(export_statement) @export
