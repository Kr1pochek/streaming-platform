import { Fragment, useMemo } from "react";
import { resolveArtistLine } from "../utils/artistRouting.js";

export default function ArtistInlineLinks({
  artistLine,
  className,
  linkClassName,
  textClassName,
  onOpenArtist,
  stopPropagation = false,
}) {
  const artistParts = useMemo(() => resolveArtistLine(artistLine), [artistLine]);

  if (!artistParts.length) {
    return null;
  }

  return (
    <span className={className}>
      {artistParts.map((artist, index) => (
        <Fragment key={`${artist.name}-${index}`}>
          {index > 0 ? ", " : null}
          {artist.id ? (
            <span
              role="button"
              tabIndex={0}
              className={linkClassName}
              aria-label={`Открыть исполнителя ${artist.name}`}
              onClick={(event) => {
                if (stopPropagation) {
                  event.stopPropagation();
                }
                onOpenArtist?.(artist.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (stopPropagation) {
                    event.stopPropagation();
                  }
                  onOpenArtist?.(artist.id);
                }
              }}
            >
              {artist.name}
            </span>
          ) : (
            <span className={textClassName}>{artist.name}</span>
          )}
        </Fragment>
      ))}
    </span>
  );
}
