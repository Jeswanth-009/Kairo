// ---------------------------------------------------------------------------
// Jake (ATS-friendly, from github.com/jakegut/resume)
// All packages available in standard TeX Live / Tectonic.
// ---------------------------------------------------------------------------
pub const JAKE_PREAMBLE: &str = r#"\documentclass[letterpaper,11pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\input{glyphtounicode}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-.5in}
\addtolength{\textheight}{1.0in}

\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{
  \vspace{-4pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

\pdfgentounicode=1

\newcommand{\resumeItem}[1]{
  \item\small{{#1 \vspace{-2pt}}}
}

\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & #2 \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \small#1 & #2 \\
    \end{tabular*}\vspace{-7pt}
}

\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}
"#;

// ---------------------------------------------------------------------------
// Expressive — narrative style with objective, replicated from
// github.com/RyanDaDeng/expressive-resume using only standard packages.
// ---------------------------------------------------------------------------
pub const EXPRESSIVE_PREAMBLE: &str = r#"\documentclass[11pt, letterpaper]{article}
\usepackage[T1]{fontenc}
\usepackage[margin=0.75in, top=0.6in, bottom=0.6in]{geometry}
\usepackage[hidelinks]{hyperref}
\usepackage{enumitem}
\usepackage{xcolor}
\usepackage{titlesec}
\usepackage{parskip}
\usepackage{tabularx}
\usepackage{lmodern}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\definecolor{accentblue}{RGB}{30, 64, 175}

% ---------- header ----------
\newcommand{\resumeheader}[5]{%
  {\Huge\bfseries #1}\par\vspace{4pt}
  \small
  \href{mailto:#2}{#2}
  \ifx&#3&\else\quad|\quad\href{https://linkedin.com/in/#3}{linkedin.com/in/#3}\fi
  \ifx&#4&\else\quad|\quad\href{https://github.com/#4}{github.com/#4}\fi
  \ifx&#5&\else\quad|\quad #5\fi
  \vspace{6pt}\par
  \rule{\linewidth}{0.4pt}\par
}

% ---------- objective ----------
\newcommand{\objective}[1]{%
  \vspace{2pt}{\small\itshape #1}\par\vspace{6pt}
}

% ---------- section ----------
\titleformat{\section}{\large\bfseries\color{accentblue}}{}{0em}{}[\vspace{-6pt}\color{accentblue}\rule{\linewidth}{0.6pt}\vspace{2pt}]
\titlespacing{\section}{0pt}{10pt}{4pt}

% ---------- experience ----------
\newcommand{\experience}[3]{%
  {\bfseries\large #1}\hfill{\small #2}\par
  #3
}

\newcommand{\role}[3]{%
  \vspace{2pt}{\bfseries #1}\hfill{\small\itshape #2}\par
  \begin{itemize}[leftmargin=1.2em, itemsep=1pt, topsep=2pt, parsep=0pt]
    #3
  \end{itemize}
}

\newcommand{\achievement}[1]{\item\small{#1}}

% ---------- project ----------
\newcommand{\project}[3]{%
  \vspace{2pt}{\bfseries #1}\hfill{\small\itshape #2}\par
  \begin{itemize}[leftmargin=1.2em, itemsep=1pt, topsep=2pt, parsep=0pt]
    #3
  \end{itemize}
}

% ---------- education ----------
\newcommand{\degree}[4]{%
  \vspace{2pt}{\bfseries #1}\quad{\small #2}\hfill{\small\itshape #3}\par
  \begin{itemize}[leftmargin=1.2em, itemsep=1pt, topsep=2pt, parsep=0pt]
    #4
  \end{itemize}
}

% ---------- tech highlight ----------
\newcommand{\tech}[1]{{\bfseries #1}}
"#;

// ---------------------------------------------------------------------------
// PlushCV — two-column layout (left: experience + projects; right: skills +
// education). Replicated from github.com/subidit/plushcv using standard
// packages only: paracol (in TeX Live), xcolor, fontawesome5 omitted for
// portability.
// ---------------------------------------------------------------------------
pub const PLUSHCV_PREAMBLE: &str = r#"\documentclass[10pt, letterpaper]{article}
\usepackage[T1]{fontenc}
\usepackage[margin=0.5in, top=0.5in, bottom=0.5in]{geometry}
\usepackage[hidelinks]{hyperref}
\usepackage{enumitem}
\usepackage{xcolor}
\usepackage{titlesec}
\usepackage{tabularx}
\usepackage{paracol}
\usepackage{lmodern}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}

\definecolor{sidecolor}{RGB}{240, 240, 240}
\definecolor{maintext}{RGB}{30, 30, 30}
\definecolor{headerbg}{RGB}{30, 30, 60}
\definecolor{accent}{RGB}{90, 90, 180}
\color{maintext}

% ---------- name section ----------
\newcommand{\namesection}[4]{%
  \colorbox{headerbg}{%
    \parbox{\dimexpr\linewidth-2\fboxsep\relax}{%
      \vspace{6pt}
      \centering
      {\Huge\bfseries\color{white} #1~#2}\\[3pt]
      {\large\color{white!80!headerbg} #3}\\[3pt]
      {\small\color{white!70!headerbg} #4}
      \vspace{6pt}
    }%
  }\par\vspace{6pt}
}

% ---------- section headings ----------
\titleformat{\section}{\bfseries\large\color{accent}}{}{0em}{}[\vspace{-6pt}\color{accent}\rule{\linewidth}{0.5pt}\vspace{2pt}]
\titlespacing{\section}{0pt}{8pt}{4pt}

\titleformat{\subsection}{\bfseries\normalsize}{}{0em}{}
\titlespacing{\subsection}{0pt}{6pt}{2pt}

% ---------- experience ----------
\newcommand{\runsubsection}[1]{{\bfseries\large #1}}
\newcommand{\descript}[1]{{\normalsize #1}}
\newcommand{\location}[1]{{\small\itshape #1}\par\vspace{2pt}}
\newcommand{\sectionsep}{\vspace{6pt}}

\newenvironment{tightemize}{%
  \begin{itemize}[leftmargin=1em, itemsep=1pt, topsep=2pt, parsep=0pt]
}{\end{itemize}}

% ---------- skills (right column) ----------
\newcommand{\skilllocation}[1]{{\small\bfseries #1:}\par}
"#;
