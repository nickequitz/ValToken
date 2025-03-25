import React, { useState, useEffect } from 'react';
import Login from './Login';
import UserList from './Users';
import api, { setToken } from '../api.js';
import '../style.css';

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeView, setActiveView] = useState('home'); // 'home', 'parties', 'games', or 'create-game'

  const checkAuth = async () => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        setToken(token);
        const response = await api.get('/profile');
        setCurrentUser(response.data);
        setIsAuthenticated(true);
      } catch (error) {
        console.error('Auth check failed:', error);
        setToken(null);
        setIsAuthenticated(false);
        setCurrentUser(null);
      }
    } else {
      setToken(null);
      setIsAuthenticated(false);
      setCurrentUser(null);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const handleLogin = async (token) => {
    setToken(token);
    await checkAuth();
  };

  const handleLogout = () => {
    setToken(null);
    setIsAuthenticated(false);
    setCurrentUser(null);
    setActiveView('home');
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="app">
      <nav className="navbar">
        <button 
          className="header-button" 
          onClick={() => setActiveView('home')}
        >
          Valorant Tokens
        </button>
        {isAuthenticated && currentUser && (
          <div className="user-controls">
            <span className="user-name">{currentUser.name}</span>
            <button onClick={handleLogout} className="logout-button">
              Logout
            </button>
          </div>
        )}
      </nav>
      <div className="content">
        {isAuthenticated ? (
          activeView === 'home' ? (
            <div className="home-buttons">
              <button 
                className="nav-button parties-button"
                onClick={() => setActiveView('parties')}
              >
                Party
              </button>
              <button 
                className="nav-button games-button"
                onClick={() => setActiveView('create-game')}
              >
                Create Game
              </button>
              <button 
                className="nav-button games-button"
                onClick={() => setActiveView('games')}
              >
                Games
              </button>
            </div>
          ) : (
            <UserList activeTab={activeView} />
          )
        ) : (
          <Login onLogin={handleLogin} />
        )}
      </div>
    </div>
  );
};

export default App;