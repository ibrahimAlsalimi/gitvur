#include <stdio.h>
#include "../include/store.h"

static int saved = 0;

static int validate(struct item *it) {
    return it->id > 0;
}

int store_save(struct item *it) {
    if (!validate(it)) {
        return -1;
    }
    saved++;
    log_line("saved");
    return 0;
}

void store_report(const stats_t *s) {
    printf("%d\n", s->count);
}
