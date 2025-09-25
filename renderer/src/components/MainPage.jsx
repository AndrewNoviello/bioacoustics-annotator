import { useState, useEffect, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, Eye } from 'lucide-react'
import { SessionContext } from '../stores/SessionContext'
import CreateSessionModal from './CreateSessionModal'

const MainPage = () => {
  const MAX_FILES_DISPLAY = 10

  const { activeProfile, activeDataDir } = useContext(SessionContext)

  const navigate = useNavigate()
  const [sessions, setSessions] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [expandedFiles, setExpandedFiles] = useState(new Set())

  const loadSessions = async () => {
    console.log("loading sessions, dataDir:", activeDataDir, "activeProfile:", activeProfile)
    if (!activeDataDir || activeProfile === 'No Profile Selected') {
      setSessions([])
      return
    }

    setIsLoading(true)
    try {
      console.log("listing sessions")
      const res = await window.electronAPI.listSessions()
      console.log(res)
      if (res.success) {
        setSessions(res.sessions || [])
      } else {
        console.error('Failed to list sessions', res.error)
        setSessions([])
      }
    } catch (err) {
      console.error('Error loading sessions', err)
      setSessions([])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSessionClick = (sessionId) => {
    navigate(`/session/${sessionId}`)
  }

  const handleDeleteSession = async (sessionId) => {
    if (!activeDataDir || activeProfile === 'No Profile Selected') {
      console.error('No data directory or profile selected');
      return;
    }

    try {
      const result = await window.electronAPI.deleteSession(sessionId);
      if (result.success) {
        console.log(result.message);
        // Refresh the sessions list
        loadSessions();
      } else {
        console.error('Failed to delete session:', result.error);
        alert(`Failed to delete session: ${result.error}`);
      }
    } catch (err) {
      console.error('Error deleting session:', err);
      alert('Error deleting session. Please try again.');
    }
  }

  const handleCreateSession = () => {
    setShowCreateModal(true)
  }

  const toggleFilesExpanded = (sessionId, e) => {
    e.stopPropagation();
    setExpandedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sessionId)) {
        newSet.delete(sessionId);
      } else {
        newSet.add(sessionId);
      }
      return newSet;
    });
  }

  useEffect(() => {
    console.log("loading sessions")
    loadSessions()
  }, [activeDataDir, activeProfile])

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-y-auto">
      <main className="flex-1 py-2 px-4">
        <div className="h-full flex flex-col">
          <div className="mb-2">
            <div className="flex flex-col">
              <div className="flex flex-row w-full justify-between items-center">
                <h2 className="text-xl font-bold text-gray-900">
                  Sessions
                </h2>
                <button
                  onClick={handleCreateSession}
                  className="text-nowrap px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  <Plus className="h-4 w-4" />
                  <span className="text-sm font-medium">Create Session</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1">
            {(!activeDataDir || activeProfile === 'No Profile Selected') ? (
              <div className="p-8 text-center">
                <p className="text-gray-500 text-sm">You must select a data directory and a profile to view sessions.</p>
              </div>
            ) : isLoading ? (
              <div className="p-8 text-center">
                <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"></div>
                <p className="text-gray-500 text-sm mt-2">Loading sessions...</p>
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-gray-500 text-sm">No sessions found. Create your first session to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => handleSessionClick(session.id)}
                    className="group relative bg-white rounded-xl border border-gray-200 hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden"
                  >
                    {/* Delete button - always visible in top right */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(session.id);
                      }}
                      className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all duration-200 z-10"
                      title="Delete session"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>

                    <div className="p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="text-lg font-semibold text-gray-900 truncate">
                          {session.name || session.id}
                        </h3>
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full font-mono">
                          /{session.id}
                        </span>
                        <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full font-medium">
                          {Object.keys(session.experiments || {}).length} experiments
                        </span>
                      </div>

                      <p className="text-sm text-gray-600 mb-3">
                        Created {new Date(session.time).toLocaleDateString()} at {new Date(session.time).toLocaleTimeString()}
                      </p>

                      {/* Files section */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-gray-700 uppercase tracking-wide">
                            Files ({session.files?.length || 0})
                          </span>
                        </div>
                        <div className="text-sm text-gray-600">
                          {session.files && session.files.length > 0 ? (
                            <div className="relative flex flex-row justify-start items-center">
                              <div className="truncate">
                                {(expandedFiles.has(session.id) ? session.files : session.files.slice(0, MAX_FILES_DISPLAY)).map((file, index) => (
                                  <span key={index}>
                                    {file.split(/[\\\/]/).pop()}
                                    {index < Math.min(expandedFiles.has(session.id) ? session.files.length - 1 : MAX_FILES_DISPLAY, session.files.length - 1) ? ', ' : ''}
                                  </span>
                                ))}
                                {session.files.length > MAX_FILES_DISPLAY && (
                                  <span
                                    onClick={(e) => toggleFilesExpanded(session.id, e)}
                                    className="text-blue-600 hover:text-blue-700 text-xs font-medium cursor-pointer"
                                  >
                                    {expandedFiles.has(session.id) ? ' Show less' : '...'}
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm text-gray-400 italic">No files</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div >
      </main >
      {/* Create Session Modal */}
      {
        showCreateModal && (
          <CreateSessionModal
            onClose={() => { setShowCreateModal(false); loadSessions() }}
          />
        )
      }
    </div >
  )
}

export default MainPage