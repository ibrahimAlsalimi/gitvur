package store

type Saver interface {
	Save(name string) error
}

type Repo struct{}

func (r *Repo) Save(name string) error {
	return r.flush()
}

func (r *Repo) flush() error {
	return nil
}

type Cache struct{}

func (c *Cache) Save(name string) error {
	return nil
}
