#ifndef STORE_H
#define STORE_H

struct item {
    int id;
    const char *name;
};

typedef struct {
    int count;
} stats_t;

int store_save(struct item *it);
void store_report(const stats_t *s);

#endif
