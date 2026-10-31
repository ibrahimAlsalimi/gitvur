#include <stdio.h>

void log_line(const char *msg) {
    fprintf(stderr, "b: %s\n", msg);
}

char *tool_name(void) {
    return "log_b";
}

int main(int argc, char **argv) {
    log_line(argv[0]);
    return argc;
}
