#include "store.h"

static int fact(int n) {
    return n <= 1 ? 1 : n * fact(n - 1);
}

static void run(void (*cb)(void)) {
    cb();
}

int main(void) {
    struct item it = { 1, "book" };
    store_save(&it);
    fact(5);
    run(0);
    return 0;
}
