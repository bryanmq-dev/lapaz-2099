import type { CityEvent } from '../simulation/types'

export function EventFeed({ events }: { events: CityEvent[] }) {
  return (
    <ol className="feed" aria-live="polite">
      {events.map((e) => (
        <li key={e.id} className={`ev ev-${e.level}`}>
          <time>{e.time}</time>
          <span>{e.text}</span>
        </li>
      ))}
    </ol>
  )
}
