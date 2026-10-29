; Python captures used by the extractor. Each pattern captures a whole node;
; `src/lang/python.rs` reads the node's fields.

(class_definition) @definition
(function_definition) @definition
(call) @call
(import_statement) @import
(import_from_statement) @import
