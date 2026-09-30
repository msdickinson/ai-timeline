#### Add input validation to the signup form

I'll add validation to the signup form. Let me look at the current implementation.

```python
src/forms.py
<<<<<<< SEARCH
class SignupForm:
    def validate(self, data):
        return True
=======
class SignupForm:
    def validate(self, data):
        if not data.get('email'):
            raise ValueError('Email is required')
        if len(data.get('password', '')) < 8:
            raise ValueError('Password must be at least 8 characters')
        return True
>>>>>>> REPLACE
```

I've added email and password validation to the signup form.

#### Now add tests for the validation

Sure, let me add tests for the new validation.

```python
tests/test_forms.py
<<<<<<< SEARCH
=======
import pytest
from src.forms import SignupForm

def test_signup_requires_email():
    form = SignupForm()
    with pytest.raises(ValueError, match='Email is required'):
        form.validate({})

def test_signup_requires_password_length():
    form = SignupForm()
    with pytest.raises(ValueError, match='Password must be at least 8'):
        form.validate({'email': 'test@test.com', 'password': '123'})

def test_signup_valid():
    form = SignupForm()
    assert form.validate({'email': 'test@test.com', 'password': 'secure123!'})
>>>>>>> REPLACE
```

All three test cases are in place. The validation is now tested.
