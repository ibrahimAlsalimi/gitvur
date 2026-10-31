package orders

import "errors"

func validate(name string) error {
	if name == "" {
		return errors.New("empty name")
	}
	return nil
}
