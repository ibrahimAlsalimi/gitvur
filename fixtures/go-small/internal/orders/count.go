package orders

func (s *Service) Count() int {
	return countdown(3)
}

func countdown(n int) int {
	if n == 0 {
		return 0
	}
	return countdown(n - 1)
}
