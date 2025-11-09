import React from 'react';

/**
 * MediaControls Component
 * 
 * Provides buttons to toggle video/audio on/off
 */

const MediaControls = ({ 
    isVideoEnabled, 
    isAudioEnabled, 
    onToggleVideo, 
    onToggleAudio 
}) => {
    return (
        <div style={{
            display: 'flex',
            gap: '10px',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '15px',
            backgroundColor: '#fff',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            marginBottom: '20px'
        }}>
            {/* Video Toggle Button */}
            <button
                onClick={onToggleVideo}
                style={{
                    padding: '12px 20px',
                    fontSize: '16px',
                    fontWeight: '500',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    backgroundColor: isVideoEnabled ? '#4CAF50' : '#f44336',
                    color: 'white',
                    transition: 'all 0.3s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}
                onMouseOver={(e) => e.target.style.opacity = '0.9'}
                onMouseOut={(e) => e.target.style.opacity = '1'}
            >
                <span>{isVideoEnabled ? '📹' : '📹'}</span>
                <span>{isVideoEnabled ? 'Video On' : 'Video Off'}</span>
            </button>

            {/* Audio Toggle Button */}
            <button
                onClick={onToggleAudio}
                style={{
                    padding: '12px 20px',
                    fontSize: '16px',
                    fontWeight: '500',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    backgroundColor: isAudioEnabled ? '#4CAF50' : '#f44336',
                    color: 'white',
                    transition: 'all 0.3s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}
                onMouseOver={(e) => e.target.style.opacity = '0.9'}
                onMouseOut={(e) => e.target.style.opacity = '1'}
            >
                <span>{isAudioEnabled ? '🎤' : '🔇'}</span>
                <span>{isAudioEnabled ? 'Mic On' : 'Mic Off'}</span>
            </button>
        </div>
    );
};

export default MediaControls;