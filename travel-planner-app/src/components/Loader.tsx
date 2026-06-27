export function AttractionSkeletonGrid() {
  return (
    <div className="attraction-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <article className="attraction-card attraction-card-skeleton" key={index}>
          <div className="skeleton-line skeleton-line-short" />
          <div className="skeleton-line skeleton-line-title" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-badges">
            <span />
            <span />
            <span />
          </div>
        </article>
      ))}
    </div>
  );
}

export function ItineraryLoader({ message }: { message: string }) {
  return (
    <div className="itinerary-loader" role="status" aria-live="polite">
      <div className="itinerary-loader-ring" aria-hidden="true" />
      <p className="itinerary-loader-message">{message}</p>
    </div>
  );
}
