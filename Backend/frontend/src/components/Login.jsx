import React, { useState } from 'react';
import api from '../api';

const Login = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: ''
  });
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      if (isLogin) {
        // Login
        const loginFormData = new FormData();
        loginFormData.append('username', formData.email);
        loginFormData.append('password', formData.password);
        
        const response = await api.post('/token', loginFormData);
        if (response.data.access_token) {
          onLogin(response.data.access_token);
        } else {
          setError('Invalid login response');
        }
      } else {
        // Signup
        const response = await api.post('/signup', {
          email: formData.email,
          password: formData.password,
          name: formData.name
        });
        
        if (response.data) {
          // After successful signup, automatically log in
          const loginFormData = new FormData();
          loginFormData.append('username', formData.email);
          loginFormData.append('password', formData.password);
          
          const loginResponse = await api.post('/token', loginFormData);
          if (loginResponse.data.access_token) {
            onLogin(loginResponse.data.access_token);
          }
        }
      }
    } catch (error) {
      console.error('Auth error:', error);
      setError(error.response?.data?.detail || 'An error occurred');
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <div className="auth-container">
      <h2>{isLogin ? 'Login' : 'Sign Up'}</h2>
      {error && <div className="error-message">{error}</div>}
      
      <form onSubmit={handleSubmit} className="auth-form">
        <input
          type="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="Email"
          required
        />
        
        <input
          type="password"
          name="password"
          value={formData.password}
          onChange={handleChange}
          placeholder="Password"
          required
        />
        
        {!isLogin && (
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Name"
            required
          />
        )}
        
        <button type="submit">
          {isLogin ? 'Login' : 'Sign Up'}
        </button>
      </form>
      
      <button 
        className="toggle-auth"
        onClick={() => {
          setIsLogin(!isLogin);
          setError('');
          setFormData({
            email: '',
            password: '',
            name: ''
          });
        }}
      >
        {isLogin ? 'Need an account? Sign up' : 'Already have an account? Login'}
      </button>
    </div>
  );
};

export default Login; 