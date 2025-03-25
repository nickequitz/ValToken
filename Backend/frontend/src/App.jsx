import React, { useState, useEffect } from 'react';
import UserList from './components/Users';
import Login from './components/Login';
import './style.css';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    setIsAuthenticated(!!token);
    setIsLoading(false);
  }, []);

  const handleLogin = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsAuthenticated(false);
  };

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="app">
      <nav className="navbar">
        <h1>Valorant Tokens</h1>
        {isAuthenticated && (
          <button onClick={handleLogout} className="logout-button">
            Logout
          </button>
        )}
      </nav>
      <div className="content">
        {isAuthenticated ? (
          <UserList />
        ) : (
          <>
            <h2>Welcome to Valorant Tokens</h2>
            <Login onLogin={handleLogin} />
          </>
        )}
      </div>
    </div>
  );
}

export default App; 