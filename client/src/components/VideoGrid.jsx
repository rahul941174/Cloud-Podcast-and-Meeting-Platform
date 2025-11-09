import React from 'react';
import VideoPlayer from './VideoPlayer';

/**
 * VideoGrid Component
 * 
 * Displays all video streams in a responsive grid layout
 * Automatically adjusts grid based on number of participants
 */

const VideoGrid = ({ localStream, remoteStreams, participants, currentUserId }) => {
    // Calculate grid layout based on number of videos
    const totalVideos = 1 + Object.keys(remoteStreams).length; // 1 (local) + remote
    
    const getGridColumns = () => {
        if (totalVideos === 1) return 1;
        if (totalVideos === 2) return 2;
        if (totalVideos <= 4) return 2;
        if (totalVideos <= 6) return 3;
        return 3; // Max 3 columns
    };

    const columns = getGridColumns();

    // Get username for a userId
    const getUserName = (userId) => {
        const participant = participants.find(p => p.userId === userId);
        return participant ? participant.username : 'Unknown';
    };

    return (
        <div style={{
            width: '100%',
            padding: '20px',
            backgroundColor: '#f5f5f5',
            borderRadius: '8px',
            marginBottom: '20px'
        }}>
            <h3 style={{ marginBottom: '15px', color: '#333' }}>
                📹 Video Call ({totalVideos} participant{totalVideos !== 1 ? 's' : ''})
            </h3>
            
            <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: '15px',
                minHeight: '400px'
            }}>
                {/* Local video (your camera) */}
                <div style={{ aspectRatio: '16/9' }}>
                    <VideoPlayer
                        stream={localStream}
                        username={getUserName(currentUserId)}
                        isLocal={true}
                        muted={true}
                    />
                </div>

                {/* Remote videos (other participants) */}
                {Object.entries(remoteStreams).map(([userId, stream]) => (
                    <div key={userId} style={{ aspectRatio: '16/9' }}>
                        <VideoPlayer
                            stream={stream}
                            username={getUserName(userId)}
                            isLocal={false}
                            muted={false}
                        />
                    </div>
                ))}
            </div>

            {/* No participants message */}
            {totalVideos === 1 && (
                <div style={{
                    textAlign: 'center',
                    padding: '20px',
                    color: '#666',
                    fontSize: '14px'
                }}>
                    Waiting for others to join...
                </div>
            )}
        </div>
    );
};

export default VideoGrid;