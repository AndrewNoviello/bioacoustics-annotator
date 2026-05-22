import React, { useEffect, useRef, useState } from 'react'

const LazyMount = ({ rootMargin = '400px', placeholderHeight, forceMount = false, children }) => {
  const sentinelRef = useRef(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (mounted) return
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true)
          observer.disconnect()
        }
      },
      { rootMargin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [mounted, rootMargin])

  if (mounted || forceMount) return children

  return (
    <div
      ref={sentinelRef}
      className="bg-gray-100 rounded"
      style={{ height: placeholderHeight }}
    />
  )
}

export default LazyMount
