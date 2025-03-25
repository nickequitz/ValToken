import uvicorn
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from enum import Enum
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
from dotenv import load_dotenv
import asyncio
from passlib.context import CryptContext
from datetime import datetime, timedelta
from jwt import encode, decode, PyJWTError

# Load environment variables
load_dotenv()

# Security
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-here")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class User(BaseModel):
    id: str
    email: str
    name: str

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class Users(BaseModel):
    users: List[User]

class PartyCreate(BaseModel):
    name: str

class Party(BaseModel):
    id: str
    name: str
    creator_id: str
    members: List[str]

class PartyInvite(BaseModel):
    party_id: str
    user_id: str

class PartyInvitation(BaseModel):
    id: str
    party_id: str
    party_name: str
    inviter_id: str
    inviter_name: str
    invitee_id: str
    status: str  # "pending", "accepted", "declined"
    created_at: datetime

class PartyInvitationCreate(BaseModel):
    party_id: str
    invitee_id: str

class PartyInvitationResponse(BaseModel):
    invitation_id: str
    status: str

class InvitationResponse(BaseModel):
    status: str

class GameFormat(str, Enum):
    FIVE_V_FIVE = "5v5"
    FOUR_V_FOUR = "4v4"
    ONE_V_ONE = "1v1"

class GameType(str, Enum):
    BEST_OF_ONE = "best_of_1"
    BEST_OF_THREE = "best_of_3"
    DEATHMATCH = "deathmatch"  # For 1v1 only

class GamePost(BaseModel):
    id: str
    party_id: Optional[str] = None
    party_name: str
    creator_id: str
    creator_name: str
    format: GameFormat
    game_type: GameType
    status: str  # "open", "in_progress", "completed", "expired"
    created_at: datetime
    expires_at: datetime
    players: List[str] = []
    max_players: int
    match_result: Optional[dict] = None

    class Config:
        extra = "forbid"
        validate_assignment = True
        allow_population_by_field_name = True
        json_encoders = {
            ObjectId: str
        }

class GamePostCreate(BaseModel):
    party_id: Optional[str] = None
    format: GameFormat
    game_type: GameType

    class Config:
        extra = "forbid"  # Prevent extra fields
        validate_assignment = True  # Validate during assignment
        allow_population_by_field_name = True  # Allow population by field name
        json_encoders = {
            ObjectId: str  # Convert ObjectId to string
        }

class MatchResult(BaseModel):
    winner_id: str
    winner_name: str
    loser_id: str
    loser_name: str
    score: str

app = FastAPI()

# MongoDB connection
MONGODB_URL = os.getenv("MONGODB_URL")
if not MONGODB_URL:
    raise ValueError("No MONGODB_URL found in environment variables")

client = None
db = None
collection = None
party_collection = None
invitation_collection = None
game_collection = None

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        token_data = TokenData(email=email)
    except PyJWTError:
        raise credentials_exception
    user = await collection.find_one({"email": token_data.email})
    if user is None:
        raise credentials_exception
    return User(id=str(user["_id"]), email=user["email"], name=user["name"])

@app.on_event("startup")
async def startup_db_client():
    global client, db, collection, party_collection, invitation_collection, game_collection
    try:
        print("Attempting to connect to MongoDB...")
        client = AsyncIOMotorClient(MONGODB_URL)
        await client.admin.command('ping')
        print("Successfully connected to MongoDB")
        db = client.userdb
        collection = db.users
        party_collection = db.parties
        invitation_collection = db.invitations
        game_collection = db.games
    except Exception as e:
        print(f"Failed to connect to MongoDB: {str(e)}")
        raise

@app.on_event("shutdown")
async def shutdown_db_client():
    global client
    if client:
        client.close()

origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/signup", response_model=User)
async def signup(user: UserCreate):
    if collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    # Check if email already exists
    if await collection.find_one({"email": user.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    
    try:
        hashed_password = get_password_hash(user.password)
        user_data = {
            "email": user.email,
            "name": user.name,
            "hashed_password": hashed_password
        }
        result = await collection.insert_one(user_data)
        return User(id=str(result.inserted_id), email=user.email, name=user.name)
    except Exception as e:
        print(f"Error creating user: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.post("/token", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    if collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    user = await collection.find_one({"email": form_data.username})
    if not user or not verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token = create_access_token(data={"sub": user["email"]})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users", response_model=Users)
async def get_users(current_user: User = Depends(get_current_user)):
    if collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        users_cursor = collection.find({})  # Get all fields except hashed_password
        users_list = []
        async for user in users_cursor:
            if "_id" in user and "email" in user and "name" in user:  # Ensure required fields exist
                users_list.append(User(
                    id=str(user["_id"]),
                    email=user["email"],
                    name=user["name"]
                ))
        return Users(users=users_list)
    except Exception as e:
        print(f"Error fetching users: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.post("/parties", response_model=Party)
async def create_party(party: PartyCreate, current_user: User = Depends(get_current_user)):
    if party_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        party_data = {
            "name": party.name,
            "creator_id": current_user.id,
            "members": [current_user.id]
        }
        result = await party_collection.insert_one(party_data)
        return Party(
            id=str(result.inserted_id),
            name=party.name,
            creator_id=current_user.id,
            members=[current_user.id]
        )
    except Exception as e:
        print(f"Error creating party: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.post("/parties/{party_id}/invite", response_model=PartyInvitationResponse)
async def invite_to_party(
    party_id: str,
    invite: PartyInvitationCreate,
    current_user: User = Depends(get_current_user)
):
    if party_collection is None or invitation_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        # Check if party exists and user is creator
        party = await party_collection.find_one({"_id": ObjectId(party_id)})
        if not party:
            raise HTTPException(status_code=404, detail="Party not found")
        
        if party["creator_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="Only the party creator can invite users")
            
        # Check if user is already a member
        if invite.invitee_id in party["members"]:
            raise HTTPException(status_code=400, detail="User is already a member")
        
        # Check if there's already a pending invitation
        existing_invite = await invitation_collection.find_one({
            "party_id": party_id,
            "invitee_id": invite.invitee_id,
            "status": "pending"
        })
        if existing_invite:
            raise HTTPException(status_code=400, detail="Invitation already sent")

        # Create invitation
        invitation_data = {
            "party_id": party_id,
            "party_name": party["name"],
            "inviter_id": current_user.id,
            "inviter_name": current_user.name,
            "invitee_id": invite.invitee_id,
            "status": "pending",
            "created_at": datetime.utcnow()
        }
        result = await invitation_collection.insert_one(invitation_data)
        
        return {"invitation_id": str(result.inserted_id), "status": "pending"}
    except Exception as e:
        print(f"Error creating invitation: {str(e)}")
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/parties/{user_id}")
async def get_user_parties(
    user_id: str, 
    current_user: User = Depends(get_current_user)
):
    if party_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        parties_cursor = party_collection.find({"members": user_id})
        parties = []
        async for party in parties_cursor:
            parties.append(Party(
                id=str(party["_id"]),
                name=party["name"],
                creator_id=party["creator_id"],
                members=party["members"]
            ))
        return {"parties": parties}
    except Exception as e:
        print(f"Error fetching parties: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/invitations/received", response_model=List[PartyInvitation])
async def get_received_invitations(current_user: User = Depends(get_current_user)):
    if invitation_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        invitations_cursor = invitation_collection.find({
            "invitee_id": current_user.id,
            "status": "pending"
        })
        invitations = []
        async for inv in invitations_cursor:
            invitations.append(PartyInvitation(
                id=str(inv["_id"]),
                party_id=inv["party_id"],
                party_name=inv["party_name"],
                inviter_id=inv["inviter_id"],
                inviter_name=inv["inviter_name"],
                invitee_id=inv["invitee_id"],
                status=inv["status"],
                created_at=inv["created_at"]
            ))
        return invitations
    except Exception as e:
        print(f"Error fetching invitations: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.post("/invitations/{invitation_id}/respond")
async def respond_to_invitation(
    invitation_id: str,
    response: InvitationResponse,
    current_user: User = Depends(get_current_user)
):
    if invitation_collection is None or party_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        # Validate status
        if response.status not in ["accepted", "declined"]:
            raise HTTPException(status_code=400, detail="Invalid status")

        # Find and update invitation
        invitation = await invitation_collection.find_one({"_id": ObjectId(invitation_id)})
        if not invitation:
            raise HTTPException(status_code=404, detail="Invitation not found")
        
        if invitation["invitee_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to respond to this invitation")

        if invitation["status"] != "pending":
            raise HTTPException(status_code=400, detail="Invitation already processed")

        # Update invitation status
        await invitation_collection.update_one(
            {"_id": ObjectId(invitation_id)},
            {"$set": {"status": response.status}}
        )

        # If accepted, add user to party members
        if response.status == "accepted":
            await party_collection.update_one(
                {"_id": ObjectId(invitation["party_id"])},
                {"$addToSet": {"members": current_user.id}}
            )

        return {"message": f"Invitation {response.status}"}
    except Exception as e:
        print(f"Error responding to invitation: {str(e)}")
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/profile", response_model=User)
async def get_profile(current_user: User = Depends(get_current_user)):
    return current_user

@app.delete("/parties/{party_id}")
async def delete_party(
    party_id: str,
    current_user: User = Depends(get_current_user)
):
    if party_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        # Check if party exists and user is creator
        party = await party_collection.find_one({"_id": ObjectId(party_id)})
        if not party:
            raise HTTPException(status_code=404, detail="Party not found")
        
        if party["creator_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="Only the party creator can delete the party")

        # Delete all invitations for this party
        await invitation_collection.delete_many({"party_id": party_id})
        
        # Delete the party
        result = await party_collection.delete_one({"_id": ObjectId(party_id)})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Party not found")
            
        return {"message": "Party deleted successfully"}
    except Exception as e:
        print(f"Error deleting party: {str(e)}")
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.post("/games", response_model=GamePost)
async def create_game_post(
    game: GamePostCreate,
    current_user: User = Depends(get_current_user)
):
    if party_collection is None or game_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        # For 1v1 games, party_id is optional
        if game.format == GameFormat.ONE_V_ONE:
            party_name = "Solo Queue"
            party_id = None
        else:
            # For team formats, require and validate party
            if not game.party_id:
                raise HTTPException(status_code=400, detail="Party ID is required for team games")
            
            try:
                party = await party_collection.find_one({"_id": ObjectId(game.party_id)})
            except:
                raise HTTPException(status_code=400, detail="Invalid party ID format")
                
            if not party:
                raise HTTPException(status_code=404, detail="Party not found")
            
            party_name = party["name"]
            party_id = game.party_id

            # For team formats (4v4, 5v5), only party creator can create listings
            if game.format in [GameFormat.FIVE_V_FIVE, GameFormat.FOUR_V_FOUR]:
                if party["creator_id"] != current_user.id:
                    raise HTTPException(status_code=403, detail="Only the party creator can create team format games")
                
                # Validate party size for game format
                party_size = len(party["members"])
                if game.format == GameFormat.FIVE_V_FIVE and party_size < 5:
                    raise HTTPException(status_code=400, detail="Need at least 5 players in party for 5v5")
                elif game.format == GameFormat.FOUR_V_FOUR and party_size < 4:
                    raise HTTPException(status_code=400, detail="Need at least 4 players in party for 4v4")

        # Check if user already has an active game
        existing_game = await game_collection.find_one({
            "creator_id": current_user.id,
            "status": {"$in": ["open", "in_progress"]}
        })
        if existing_game:
            raise HTTPException(status_code=400, detail="You already have an active game listing")

        # Validate game type for 1v1
        if game.format == GameFormat.ONE_V_ONE and game.game_type != GameType.DEATHMATCH:
            raise HTTPException(status_code=400, detail="1v1 format only supports deathmatch game type")
        elif game.format != GameFormat.ONE_V_ONE and game.game_type == GameType.DEATHMATCH:
            raise HTTPException(status_code=400, detail="Deathmatch is only available for 1v1 format")

        # Calculate max players based on format
        max_players = {
            GameFormat.FIVE_V_FIVE: 10,
            GameFormat.FOUR_V_FOUR: 8,
            GameFormat.ONE_V_ONE: 2
        }[game.format]

        # Set expiration time (30 minutes from now) using UTC
        created_at = datetime.utcnow()
        expires_at = created_at + timedelta(minutes=30)

        # Create game post
        game_data = {
            "party_id": party_id,
            "party_name": party_name,
            "creator_id": current_user.id,
            "creator_name": current_user.name,
            "format": game.format,
            "game_type": game.game_type,
            "status": "open",
            "created_at": created_at,
            "expires_at": expires_at,
            "players": [current_user.id],
            "ready_players": [],
            "max_players": max_players,
            "team1_party_id": party_id if game.format != GameFormat.ONE_V_ONE else None,
            "team2_party_id": None
        }
        result = await game_collection.insert_one(game_data)
        
        return GamePost(
            id=str(result.inserted_id),
            **game_data
        )
    except Exception as e:
        print(f"Error creating game post: {str(e)}")
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/games/party/{party_id}", response_model=List[GamePost])
async def get_party_games(
    party_id: str,
    current_user: User = Depends(get_current_user)
):
    if game_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        # Get current time in UTC
        current_time = datetime.utcnow()
        
        # Update expired games
        await game_collection.update_many(
            {
                "party_id": party_id,
                "status": "open",
                "expires_at": {"$lt": current_time}
            },
            {"$set": {"status": "expired"}}
        )

        # Fetch games
        games_cursor = game_collection.find({"party_id": party_id})
        games = []
        async for game in games_cursor:
            # Hide creator info if game is open and user is not the creator
            if game["status"] == "open" and game["creator_id"] != current_user.id:
                game["creator_name"] = "Anonymous"
            
            # Convert MongoDB datetime to UTC if needed
            created_at = game["created_at"]
            expires_at = game["expires_at"]
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=None)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=None)
            
            games.append(GamePost(
                id=str(game["_id"]),
                party_id=game["party_id"],
                party_name=game["party_name"],
                creator_id=game["creator_id"],
                creator_name=game["creator_name"],
                format=game["format"],
                game_type=game["game_type"],
                status=game["status"],
                created_at=created_at,
                expires_at=expires_at,
                players=game["players"],
                max_players=game["max_players"],
                match_result=game.get("match_result")
            ))
        return games
    except Exception as e:
        print(f"Error fetching games: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.post("/games/{game_id}/join")
async def join_game(
    game_id: str,
    current_user: User = Depends(get_current_user)
):
    if game_collection is None or party_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        game = await game_collection.find_one({"_id": ObjectId(game_id)})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        
        if current_user.id in game["players"]:
            raise HTTPException(status_code=400, detail="You are already in this game")
        
        if len(game["players"]) >= game["max_players"]:
            raise HTTPException(status_code=400, detail="Game is full")
        
        if game["status"] != "open":
            raise HTTPException(status_code=400, detail="Game is not open")

        # Ensure we're comparing UTC times
        current_time = datetime.utcnow()
        expires_at = game["expires_at"]
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=None)

        if expires_at < current_time:
            raise HTTPException(status_code=400, detail="Game has expired")

        # For team formats, need to be in a party
        if game["format"] in [GameFormat.FIVE_V_FIVE, GameFormat.FOUR_V_FOUR]:
            # Get user's parties where they are the creator
            user_parties = await party_collection.find({
                "creator_id": current_user.id
            }).to_list(length=None)

            if not user_parties:
                raise HTTPException(status_code=400, detail="You must be a party creator to join team format games")

            # Check if any of user's parties has enough members
            valid_party = None
            required_size = 5 if game["format"] == GameFormat.FIVE_V_FIVE else 4
            for party in user_parties:
                if len(party["members"]) >= required_size:
                    valid_party = party
                    break

            if not valid_party:
                raise HTTPException(
                    status_code=400, 
                    detail=f"You need a party with at least {required_size} members to join this game"
                )

            # Update game with second team's party ID
            update_data = {
                "$addToSet": {"players": current_user.id},
                "$set": {
                    "status": "in_progress",
                    "team2_party_id": str(valid_party["_id"])
                }
            }
        else:
            # For 1v1, any user can join
            update_data = {
                "$addToSet": {"players": current_user.id},
                "$set": {"status": "in_progress"}
            }

        await game_collection.update_one(
            {"_id": ObjectId(game_id)},
            update_data
        )

        return {"message": "Joined game successfully"}
    except Exception as e:
        print(f"Error joining game: {str(e)}")
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.post("/games/{game_id}/result")
async def submit_match_result(
    game_id: str,
    result: MatchResult,
    current_user: User = Depends(get_current_user)
):
    if game_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        game = await game_collection.find_one({"_id": ObjectId(game_id)})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        
        if game["status"] != "in_progress":
            raise HTTPException(status_code=400, detail="Game is not in progress")

        # For team formats, only party creators can submit results
        if game["format"] in [GameFormat.FIVE_V_FIVE, GameFormat.FOUR_V_FOUR]:
            if current_user.id != game["creator_id"] and not (
                game.get("team2_party_id") and 
                await party_collection.find_one({
                    "_id": ObjectId(game["team2_party_id"]),
                    "creator_id": current_user.id
                })
            ):
                raise HTTPException(status_code=403, detail="Only party creators can submit results for team games")
        else:
            # For 1v1, any player can submit results
            if current_user.id not in game["players"]:
                raise HTTPException(status_code=403, detail="You must be a player to submit results")
            
            if current_user.id not in [result.winner_id, result.loser_id]:
                raise HTTPException(status_code=403, detail="You can only submit results involving yourself")

        await game_collection.update_one(
            {"_id": ObjectId(game_id)},
            {
                "$set": {
                    "status": "completed",
                    "match_result": {
                        "winner_id": result.winner_id,
                        "winner_name": result.winner_name,
                        "loser_id": result.loser_id,
                        "loser_name": result.loser_name,
                        "score": result.score,
                        "reported_by": current_user.id,
                        "reported_at": datetime.utcnow()
                    }
                }
            }
        )

        return {"message": "Match result submitted successfully"}
    except Exception as e:
        print(f"Error submitting match result: {str(e)}")
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.delete("/games/{game_id}")
async def delete_game(
    game_id: str,
    current_user: User = Depends(get_current_user)
):
    if game_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        game = await game_collection.find_one({"_id": ObjectId(game_id)})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        
        if game["creator_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="Only the game creator can delete the game")

        result = await game_collection.delete_one({"_id": ObjectId(game_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Game not found")
            
        return {"message": "Game deleted successfully"}
    except Exception as e:
        print(f"Error deleting game: {str(e)}")
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.post("/games/{game_id}/ready")
async def ready_up(
    game_id: str,
    current_user: User = Depends(get_current_user)
):
    if game_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        game = await game_collection.find_one({"_id": ObjectId(game_id)})
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        
        if current_user.id not in game["players"]:
            raise HTTPException(status_code=403, detail="You must be a player to ready up")
        
        if game["status"] != "in_progress":
            raise HTTPException(status_code=400, detail="Game is not in progress")

        # Add player to ready list if not already ready
        if current_user.id not in game.get("ready_players", []):
            await game_collection.update_one(
                {"_id": ObjectId(game_id)},
                {"$addToSet": {"ready_players": current_user.id}}
            )

        # Check if all players are ready
        updated_game = await game_collection.find_one({"_id": ObjectId(game_id)})
        if len(updated_game.get("ready_players", [])) == len(updated_game["players"]):
            await game_collection.update_one(
                {"_id": ObjectId(game_id)},
                {"$set": {"status": "ready_to_start"}}
            )
            return {"message": "All players ready, game can start!"}

        return {"message": "Ready status updated"}
    except Exception as e:
        print(f"Error updating ready status: {str(e)}")
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/games", response_model=List[GamePost])
async def get_all_games(current_user: User = Depends(get_current_user)):
    if game_collection is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    try:
        # Get current time in UTC
        current_time = datetime.utcnow()
        
        # Update expired games
        await game_collection.update_many(
            {
                "status": "open",
                "expires_at": {"$lt": current_time}
            },
            {"$set": {"status": "expired"}}
        )

        # Fetch all games
        games_cursor = game_collection.find({})
        games = []
        async for game in games_cursor:
            # Hide creator info if game is open and user is not the creator
            if game["status"] == "open" and game["creator_id"] != current_user.id:
                game["creator_name"] = "Anonymous"
            
            # Convert MongoDB datetime to UTC if needed
            created_at = game["created_at"]
            expires_at = game["expires_at"]
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=None)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=None)
            
            games.append(GamePost(
                id=str(game["_id"]),
                party_id=game["party_id"],
                party_name=game["party_name"],
                creator_id=game["creator_id"],
                creator_name=game["creator_name"],
                format=game["format"],
                game_type=game["game_type"],
                status=game["status"],
                created_at=created_at,
                expires_at=expires_at,
                players=game["players"],
                max_players=game["max_players"],
                match_result=game.get("match_result")
            ))
        return games
    except Exception as e:
        print(f"Error fetching games: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)



