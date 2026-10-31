package orders

import (
	"fmt"

	"example.com/shop/internal/store"
)

type Service struct {
	repo *store.Repo
}

func NewService() *Service {
	return &Service{repo: &store.Repo{}}
}

func Submit(name string) error {
	s := NewService()
	return s.Place(name)
}

func (s *Service) Place(name string) error {
	if err := validate(name); err != nil {
		return fmt.Errorf("invalid: %w", err)
	}
	return s.repo.Save(name)
}
