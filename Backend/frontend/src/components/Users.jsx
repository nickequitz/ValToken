import React, { useEffect, useState } from 'react';
import api from "../api.js";
import './Users.css';

const UserList = ({ activeTab }) => {
  const [parties, setParties] = useState([]);
  const [newPartyName, setNewPartyName] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [selectedParty, setSelectedParty] = useState(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [invitations, setInvitations] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [games, setGames] = useState([]);
  const [partyMembers, setPartyMembers] = useState({});
  const [matchResult, setMatchResult] = useState({
    winner_id: '',
    winner_name: '',
    loser_id: '',
    loser_name: '',
    score: ''
  });
  const [allGames, setAllGames] = useState([]);
  const [gameFormat, setGameFormat] = useState('');
  const [hasCreatedGame, setHasCreatedGame] = useState(false);

  const fetchCurrentUser = async () => {
    try {
      const response = await api.get('/profile');
      setCurrentUser(response.data);
      // After getting current user, fetch their parties
      fetchParties(response.data.id);
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  const fetchParties = async (userId) => {
    try {
      const response = await api.get(`/parties/${userId}`);
      setParties(response.data.parties);
      setError('');
    } catch (error) {
      console.error('Error fetching parties:', error);
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        window.location.reload();
      } else {
        setError(error.response?.data?.detail || 'Failed to fetch parties');
      }
    }
  };

  const fetchInvitations = async () => {
    try {
      const response = await api.get('/invitations/received');
      setInvitations(response.data);
    } catch (error) {
      console.error('Error fetching invitations:', error);
      setError(error.response?.data?.detail || 'Failed to fetch invitations');
    }
  };

  const fetchGames = async (partyId) => {
    try {
      let response;
      if (partyId) {
        response = await api.get(`/games/party/${partyId}`);
      } else {
        response = await api.get('/games');
      }
      setGames(response.data);
    } catch (error) {
      console.error('Error fetching games:', error);
      setError(error.response?.data?.detail || 'Failed to fetch games');
    }
  };

  const fetchPartyMembers = async (party) => {
    try {
      const response = await api.get('/users');
      const users = response.data.users;
      const memberDetails = {};
      party.members.forEach(memberId => {
        const user = users.find(u => u.id === memberId);
        if (user) {
          memberDetails[memberId] = user.name;
        }
      });
      setPartyMembers(memberDetails);
    } catch (error) {
      console.error('Error fetching party members:', error);
      setError(error.response?.data?.detail || 'Failed to fetch party members');
    }
  };

  const handleCreateParty = async (e) => {
    e.preventDefault();
    if (!newPartyName.trim()) return;

    try {
      await api.post('/parties', {
        name: newPartyName
      });
      setNewPartyName('');
      fetchParties(currentUser.id);
      setSuccessMessage('Party created successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
      setError('');
    } catch (error) {
      console.error('Error creating party:', error);
      setError(error.response?.data?.detail || 'Failed to create party');
    }
  };

  const handleInviteByUsername = async (e) => {
    e.preventDefault();
    if (!selectedParty || !inviteUsername.trim()) return;

    try {
      // First, find the user by username
      const response = await api.get('/users');
      const users = response.data.users;
      const invitedUser = users.find(user => user.name === inviteUsername.trim());

      if (!invitedUser) {
        setError('User not found');
        return;
      }

      await api.post(`/parties/${selectedParty.id}/invite`, {
        party_id: selectedParty.id,
        invitee_id: invitedUser.id
      });
      
      setInviteUsername('');
      setSuccessMessage('Invitation sent successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
      setError('');
    } catch (error) {
      console.error('Error inviting user:', error);
      setError(error.response?.data?.detail || 'Failed to send invitation');
    }
  };

  const handleInvitationResponse = async (invitationId, status) => {
    try {
      // Send the response to the server
      const response = await api.post(`/invitations/${invitationId}/respond`, { status });
      
      // Update local state
      setInvitations(prev => prev.filter(inv => inv.id !== invitationId));

      // If accepted, update parties list
      if (status === 'accepted') {
        const partiesResponse = await api.get(`/parties/${currentUser.id}`);
        setParties(partiesResponse.data.parties);
      }

      // Show success message
      setSuccessMessage(status === 'accepted' ? 'You have joined the party!' : 'Invitation declined');
      setTimeout(() => setSuccessMessage(''), 3000);
      setError('');
    } catch (error) {
      console.error('Error responding to invitation:', error);
      setError(error.response?.data?.detail || 'Failed to respond to invitation');
    }
  };

  const handleDeleteParty = async (partyId) => {
    try {
      await api.delete(`/parties/${partyId}`);
      setParties(parties.filter(party => party.id !== partyId));
      if (selectedParty?.id === partyId) {
        setSelectedParty(null);
      }
      setSuccessMessage('Party deleted successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Error deleting party:', error);
      setError(error.response?.data?.detail || 'Failed to delete party');
    }
  };

  const handleGameFormatChange = (e) => {
    const format = e.target.value;
    let gameType = newGame.gameType;
    
    // If switching to 1v1, force deathmatch
    if (format === '1v1') {
      gameType = 'deathmatch';
    }
    // If switching from 1v1, change from deathmatch to best_of_1
    else if (gameType === 'deathmatch') {
      gameType = 'best_of_1';
    }

    setNewGame({ format, gameType });
  };

  const handleCreateGame = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    try {
      // Map the frontend format values to what the backend expects
      const formatMap = {
        'ffa': '1v1',  // Map FFA to 1v1 since that's what the server expects
        '4v4': '4v4',
        '5v5': '5v5'
      };

      // Base game data without party_id
      const gameData = {
        format: formatMap[gameFormat] || gameFormat,
        game_type: 'deathmatch'
      };

      // Only add party_id if this is a team game
      if (gameFormat === '4v4' || gameFormat === '5v5') {
        if (!selectedParty) {
          setError('Please select a party for team games');
          return;
        }
        gameData.party_id = selectedParty.id.toString();
      }

      console.log('Sending game data:', JSON.stringify(gameData, null, 2));

      const response = await api.post('/games', gameData);
      
      // Set hasCreatedGame to true and refresh games
      setHasCreatedGame(true);
      await fetchAllGames();
      
      setSuccessMessage('Game created successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
      setError('');
    } catch (error) {
      console.error('Error creating game:', error);
      console.error('Full error response:', JSON.stringify(error.response?.data, null, 2));
      
      if (error.response?.data?.detail) {
        const details = error.response.data.detail;
        if (Array.isArray(details)) {
          const errorMessages = details.map(err => err.msg).join(', ');
          setError(errorMessages);
        } else {
          setError(details);
        }
      } else {
        setError('Failed to create game');
      }
    }
  };

  // Filter games by the selected format and ensure we handle undefined values
  const filteredGames = games.filter(game => 
    game && game.format && gameFormat && 
    game.format.toLowerCase() === gameFormat.toLowerCase()
  );

  const handleJoinGame = async (gameId) => {
    try {
      const gameToJoin = allGames.find(g => g.id === gameId) || games.find(g => g.id === gameId);
      
      // For team games (4v4 or 5v5), require party selection
      if ((gameToJoin.format === '4v4' || gameToJoin.format === '5v5') && !selectedParty) {
        setError('Please select a party to join team games');
        return;
      }

      // For team games, check if party has enough players
      if (selectedParty && (gameToJoin.format === '4v4' || gameToJoin.format === '5v5')) {
        const requiredPlayers = gameToJoin.format === '5v5' ? 5 : 4;
        if (selectedParty.members.length < requiredPlayers) {
          setError(`Your party needs at least ${requiredPlayers} players to join this game`);
          return;
        }
      }

      await api.post(`/games/${gameId}/join`, {
        party_id: (gameToJoin.format === '4v4' || gameToJoin.format === '5v5') ? selectedParty?.id : null
      });

      // Refresh both game lists
      fetchAllGames();
      if (selectedParty) {
        fetchGames(selectedParty.id);
      }
      
      setSuccessMessage('Joined game successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
      setError('');
    } catch (error) {
      console.error('Error joining game:', error);
      setError(error.response?.data?.detail || 'Failed to join game');
    }
  };

  const handleLeaveGame = async (gameId) => {
    try {
      await api.post(`/games/${gameId}/leave`);
      if (selectedParty) {
        fetchGames(selectedParty.id);
      }
      setSuccessMessage('Left game successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
      setError('');
    } catch (error) {
      console.error('Error leaving game:', error);
      setError(error.response?.data?.detail || 'Failed to leave game');
    }
  };

  const handleSubmitMatchResult = async (gameId, isWinner) => {
    if (!selectedParty) return;

    try {
      const game = games.find(g => g.id === gameId);
      const otherPlayer = game.players.find(p => p !== currentUser.id);
      
      const result = {
        winner_id: isWinner ? currentUser.id : otherPlayer,
        winner_name: isWinner ? currentUser.name : game.players.find(p => p === otherPlayer)?.name,
        loser_id: isWinner ? otherPlayer : currentUser.id,
        loser_name: isWinner ? game.players.find(p => p === otherPlayer)?.name : currentUser.name,
        score: matchResult.score
      };

      await api.post(`/games/${gameId}/result`, result);
      fetchGames(selectedParty.id);
      setSuccessMessage('Match result submitted successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
      setError('');
    } catch (error) {
      console.error('Error submitting match result:', error);
      setError(error.response?.data?.detail || 'Failed to submit match result');
    }
  };

  const handleDeleteGame = async (gameId) => {
    try {
      await api.delete(`/games/${gameId}`);
      if (selectedParty) {
        fetchGames(selectedParty.id);
      }
      setSuccessMessage('Game deleted successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
      setError('');
    } catch (error) {
      console.error('Error deleting game:', error);
      setError(error.response?.data?.detail || 'Failed to delete game');
    }
  };

  const handleReadyUp = async (gameId) => {
    try {
      const response = await api.post(`/games/${gameId}/ready`);
      if (selectedParty) {
        fetchGames(selectedParty.id);
      }
      setSuccessMessage(response.data.message);
      setTimeout(() => setSuccessMessage(''), 3000);
      setError('');
    } catch (error) {
      console.error('Error readying up:', error);
      setError(error.response?.data?.detail || 'Failed to ready up');
    }
  };

  const canSubmitResult = (game) => {
    if (!currentUser || !game) return false;
    
    // For team formats (4v4, 5v5), only party creators can submit results
    if (game.format === '5v5' || game.format === '4v4') {
      return game.creator_id === currentUser.id || 
             (game.team2_party_id && game.players.includes(currentUser.id));
    }
    
    // For 1v1, any player can submit results
    return game.players.includes(currentUser.id);
  };

  const fetchAllGames = async () => {
    try {
      const response = await api.get('/games');
      setGames(response.data);
      setAllGames(response.data);
    } catch (error) {
      console.error('Error fetching all games:', error);
      setError(error.response?.data?.detail || 'Failed to fetch games');
    }
  };

  // Add this helper function to filter valid parties based on game format
  const getValidParties = (format) => {
    if (!format || format === 'ffa') return [];
    
    const requiredMembers = {
      '4v4': 4,
      '5v5': 5
    };

    return parties.filter(party => 
      party.members.length === requiredMembers[format]
    );
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetchCurrentUser();
      fetchInvitations();
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      if (activeTab === 'parties') {
        fetchParties(currentUser.id);
      } else if (activeTab === 'games' || activeTab === 'create-game') {
        fetchAllGames();
      }
    }
  }, [currentUser, activeTab]);

  useEffect(() => {
    let interval;
    if (activeTab === 'games' || activeTab === 'create-game') {
      interval = setInterval(fetchAllGames, 5000);
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [activeTab]);

  if (!localStorage.getItem('token')) {
    return (
      <div className="container">
        <div className="error-message">Please log in to view your parties</div>
      </div>
    );
  }

  return (
    <div className="container">
      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}

      {activeTab === 'parties' ? (
        <>
          {/* Invitations Section */}
          <div className="invitations-section">
            <h2>Party Invitations</h2>
            {invitations.length > 0 ? (
              <ul className="invitations-list">
                {invitations.map((invitation) => (
                  <li key={invitation.id} className="invitation-item">
                    <div className="invitation-info">
                      <span className="inviter">{invitation.inviter_name}</span>
                      <span>has invited you to join</span>
                      <span className="party-name">{invitation.party_name}</span>
                    </div>
                    <div className="invitation-actions">
                      <button
                        type="button"
                        className="accept-button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleInvitationResponse(invitation.id, 'accepted');
                        }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="decline-button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleInvitationResponse(invitation.id, 'declined');
                        }}
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="no-invitations">No pending invitations</p>
            )}
          </div>

          <div className="parties-section">
            <div className="create-party-container">
              <h2>Create New Party</h2>
              <form onSubmit={handleCreateParty} className="create-party-form">
                <input
                  type="text"
                  value={newPartyName}
                  onChange={(e) => setNewPartyName(e.target.value)}
                  placeholder="Enter party name"
                  required
                />
                <button type="submit">Create Party</button>
              </form>
            </div>

            <div className="my-parties-container">
              <h2>My Parties</h2>
              {parties.length > 0 ? (
                <ul className="parties-list">
                  {parties.map((party) => (
                    <li 
                      key={party.id} 
                      className={`party-item ${selectedParty?.id === party.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedParty(party);
                        fetchPartyMembers(party);
                      }}
                    >
                      <div className="party-info">
                        <span className="party-name">{party.name}</span>
                        <span className="party-members">Members: {party.members.length}</span>
                      </div>
                      {selectedParty?.id === party.id && (
                        <div className="party-actions">
                          <div className="party-members-list">
                            <h4>Party Members:</h4>
                            <ul>
                              {party.members.map(memberId => (
                                <li key={memberId} className="party-member">
                                  <span className="member-name">{partyMembers[memberId] || 'Loading...'}</span>
                                  {memberId === party.creator_id && (
                                    <span className="creator-badge">Creator</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                          {party.creator_id === currentUser?.id && (
                            <>
                              <form onSubmit={handleInviteByUsername} className="invite-form">
                                <input
                                  type="text"
                                  value={inviteUsername}
                                  onChange={(e) => setInviteUsername(e.target.value)}
                                  placeholder="Enter username to invite"
                                  onClick={(e) => e.stopPropagation()}
                                  required
                                />
                                <button 
                                  type="submit"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Invite
                                </button>
                              </form>
                              <button 
                                className="delete-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteParty(party.id);
                                }}
                              >
                                Delete Party
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="no-parties">No parties yet</p>
              )}
            </div>
          </div>
        </>
      ) : activeTab === 'create-game' ? (
        <div className="game-listings-section">
          <h2>Create New Game</h2>
          <form 
            className="create-game-form standalone"
            onSubmit={handleCreateGame}
          >
            <select
              value={gameFormat}
              onChange={(e) => {
                setGameFormat(e.target.value);
                setHasCreatedGame(false);
                setSelectedParty(null);
              }}
              className={!gameFormat ? 'placeholder' : ''}
            >
              <option value="" disabled>Gamemode</option>
              <option value="ffa">FFA Deathmatch</option>
              <option value="4v4">4v4</option>
              <option value="5v5">5v5</option>
            </select>

            {gameFormat && gameFormat !== 'ffa' && (
              <select
                value={selectedParty?.id || ''}
                onChange={(e) => {
                  const party = parties.find(p => p.id === e.target.value);
                  setSelectedParty(party || null);
                }}
                className={!selectedParty ? 'placeholder' : ''}
              >
                <option value="" disabled>Select Party</option>
                {getValidParties(gameFormat).map(party => (
                  <option key={party.id} value={party.id}>
                    {party.name} ({party.members.length} members)
                  </option>
                ))}
                {getValidParties(gameFormat).length === 0 && (
                  <option value="" disabled>No valid parties for {gameFormat}</option>
                )}
              </select>
            )}

            <button
              type="submit"
              disabled={
                !gameFormat || 
                (gameFormat !== 'ffa' && !selectedParty)
              }
            >
              Create Game
            </button>
          </form>
          {hasCreatedGame && (
            <div className="games-list standalone">
              <h3>Active {gameFormat.toUpperCase()} Games</h3>
              {filteredGames.length > 0 ? (
                <ul>
                  {filteredGames.map((game) => (
                    <li key={game.id} className="game-item">
                      <div className="game-info">
                        <span className={`game-format ${game.format === '1v1' ? 'deathmatch' : ''}`}>
                          {game.format}
                        </span>
                        <span className="game-type">
                          {game.game_type}
                        </span>
                        <span className="game-players">
                          Players: {game.players.length}/{game.max_players}
                        </span>
                        {game.status === 'open' && (
                          <span className="game-expires">
                            Expires in: {Math.max(0, Math.floor((new Date(game.expires_at).getTime() - new Date().getTime()) / 60000))} minutes
                          </span>
                        )}
                        {game.creator_name && (
                          <span className="game-creator">
                            Created by: {game.creator_name}
                          </span>
                        )}
                        {game.status === 'completed' && game.match_result && (
                          <div className="match-result">
                            <span className="winner">{game.match_result.winner_name}</span>
                            <span>defeated</span>
                            <span className="loser">{game.match_result.loser_name}</span>
                            <span className="score">{game.match_result.score}</span>
                          </div>
                        )}
                        {game.status === 'in_progress' && (
                          <div className="ready-status">
                            Ready Players: {game.ready_players?.length || 0}/{game.players.length}
                          </div>
                        )}
                      </div>
                      <div className="game-actions">
                        {game.status === 'open' && !game.players.includes(currentUser?.id) && (
                          <button
                            type="button"
                            className="join-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleJoinGame(game.id);
                            }}
                            title={(game.format === '4v4' || game.format === '5v5') && !selectedParty ? 
                              'Select a party to join team games' : ''}
                          >
                            Join
                          </button>
                        )}
                        {game.status === 'in_progress' && canSubmitResult(game) && (
                          <div className="game-controls">
                            {!game.ready_players?.includes(currentUser.id) && (
                              <button
                                type="button"
                                className="ready-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleReadyUp(game.id);
                                }}
                              >
                                Ready Up
                              </button>
                            )}
                            <div className="match-result-form">
                              <input
                                type="text"
                                placeholder="Enter match score"
                                value={matchResult.score}
                                onChange={(e) => setMatchResult({ ...matchResult, score: e.target.value })}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <button
                                type="button"
                                className="win-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSubmitMatchResult(game.id, true);
                                }}
                              >
                                I Won
                              </button>
                              <button
                                type="button"
                                className="lose-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSubmitMatchResult(game.id, false);
                                }}
                              >
                                I Lost
                              </button>
                            </div>
                          </div>
                        )}
                        {game.status === 'expired' && (
                          <span className="expired-badge">Expired</span>
                        )}
                        {game.creator_id === currentUser?.id && game.status !== 'completed' && (
                          <button
                            type="button"
                            className="delete-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteGame(game.id);
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="no-games">No active games for this format</p>
              )}
            </div>
          )}
        </div>
      ) : activeTab === 'games' ? (
        <div className="game-listings-section">
          <h2>Game Listings</h2>
          <div className="games-list standalone">
            {games.length > 0 ? (
              <ul>
                {games.map((game) => (
                  <li key={game.id} className="game-item">
                    <div className="game-info">
                      <span className={`game-format ${game.format === '1v1' ? 'deathmatch' : ''}`}>
                        {game.format}
                      </span>
                      <span className="game-type">
                        {game.game_type}
                      </span>
                      <span className="game-players">
                        Players: {game.players.length}/{game.max_players}
                      </span>
                      {game.status === 'open' && (
                        <span className="game-expires">
                          Expires in: {Math.max(0, Math.floor((new Date(game.expires_at).getTime() - new Date().getTime()) / 60000))} minutes
                        </span>
                      )}
                      {game.creator_name && (
                        <span className="game-creator">
                          Created by: {game.creator_name}
                        </span>
                      )}
                      {game.status === 'completed' && game.match_result && (
                        <div className="match-result">
                          <span className="winner">{game.match_result.winner_name}</span>
                          <span>defeated</span>
                          <span className="loser">{game.match_result.loser_name}</span>
                          <span className="score">{game.match_result.score}</span>
                        </div>
                      )}
                      {game.status === 'in_progress' && (
                        <div className="ready-status">
                          Ready Players: {game.ready_players?.length || 0}/{game.players.length}
                        </div>
                      )}
                    </div>
                    <div className="game-actions">
                      {game.status === 'open' && !game.players.includes(currentUser?.id) && (
                        <button
                          type="button"
                          className="join-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleJoinGame(game.id);
                          }}
                          title={(game.format === '4v4' || game.format === '5v5') && !selectedParty ? 
                            'Select a party to join team games' : ''}
                        >
                          Join
                        </button>
                      )}
                      {game.status === 'in_progress' && canSubmitResult(game) && (
                        <div className="game-controls">
                          {!game.ready_players?.includes(currentUser.id) && (
                            <button
                              type="button"
                              className="ready-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReadyUp(game.id);
                              }}
                            >
                              Ready Up
                            </button>
                          )}
                          <div className="match-result-form">
                            <input
                              type="text"
                              placeholder="Enter match score"
                              value={matchResult.score}
                              onChange={(e) => setMatchResult({ ...matchResult, score: e.target.value })}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <button
                              type="button"
                              className="win-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSubmitMatchResult(game.id, true);
                              }}
                            >
                              I Won
                            </button>
                            <button
                              type="button"
                              className="lose-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSubmitMatchResult(game.id, false);
                              }}
                            >
                              I Lost
                            </button>
                          </div>
                        </div>
                      )}
                      {game.status === 'expired' && (
                        <span className="expired-badge">Expired</span>
                      )}
                      {game.creator_id === currentUser?.id && game.status !== 'completed' && (
                        <button
                          type="button"
                          className="delete-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteGame(game.id);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="no-games">No active games</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default UserList;